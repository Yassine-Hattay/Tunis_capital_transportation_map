#!/usr/bin/env python3
"""
extract_places.py — Robust extraction of place names from PMTiles.
Extracts 'place' and 'poi' layers, converts MVT coordinates to WGS84 Lat/Lon,
and saves a compact JSON index.
"""
import sys
import json
import gzip
import math
from pathlib import Path
from pmtiles.reader import Reader, MmapSource

try:
    import mapbox_vector_tile
except ImportError:
    print("Error: mapbox-vector-tile is required.")
    print("Install with: pip install mapbox-vector-tile")
    sys.exit(1)

# ── Coordinate Conversion ──────────────────────────────────────────────────

def mvt_to_wgs84(z, tx, ty, px, py, extent=4096):
    """
    Convert MVT tile pixel coordinates to WGS84 Lat/Lon.
    MVT coords are 0,0 at top-left (NW).
    """
    n = 2.0 ** z
    # Calculate tile bounds in degrees
    west  = tx / n * 360.0 - 180.0
    east  = (tx + 1) / n * 360.0 - 180.0
    lat_rad_n = math.atan(math.sinh(math.pi * (1 - 2 * ty / n)))
    lat_rad_s = math.atan(math.sinh(math.pi * (1 - 2 * (ty + 1) / n)))
    north = math.degrees(lat_rad_n)
    south = math.degrees(lat_rad_s)
    
    # Interpolate pixel coordinates
    lon = west  + (px / extent) * (east - west)
    lat = south + (1 - py / extent) * (north - south)
    
    return round(lon, 5), round(lat, 5)

# ── Tile Decoding ──────────────────────────────────────────────────────────

def try_decode_tile(tile_data):
    """Try multiple decoding strategies for a tile."""
    # Strategy 1: Direct decode (uncompressed MVT)
    try:
        return mapbox_vector_tile.decode(tile_data), "direct"
    except Exception:
        pass
    
    # Strategy 2: Gzip decompress then decode
    if len(tile_data) >= 2 and tile_data[:2] == b'\x1f\x8b':
        try:
            decompressed = gzip.decompress(tile_data)
            return mapbox_vector_tile.decode(decompressed), "gzip"
        except Exception:
            pass
    
    # Strategy 3: Zstd (if library available)
    if len(tile_data) >= 4 and tile_data[:4] == b'\x28\xb5\x2f\xfd':
        try:
            import zstd
            decompressed = zstd.decompress(tile_data)
            return mapbox_vector_tile.decode(decompressed), "zstd"
        except Exception:
            pass
            
    return None, "unknown"

# ── Main Logic ─────────────────────────────────────────────────────────────

def tiles_for_bbox(z, west, south, east, north):
    """Return list of (x, y) tile coords covering the bbox at zoom z."""
    n = 2 ** z
    def lon_to_x(lon): return int((lon + 180) / 360 * n)
    def lat_to_y(lat):
        lat_r = math.radians(lat)
        return int((1 - math.log(math.tan(lat_r) + 1/math.cos(lat_r)) / math.pi) / 2 * n)
    
    x0, x1 = lon_to_x(west), lon_to_x(east)
    y0, y1 = lat_to_y(north), lat_to_y(south)
    
    tiles = []
    for x in range(max(0, x0), min(n-1, x1) + 1):
        for y in range(max(0, y0), min(n-1, y1) + 1):
            tiles.append((x, y))
    return tiles

def extract(pmtiles_path):
    print(f"📂 Reading: {pmtiles_path}")
    
    with open(pmtiles_path, 'r+b') as f:
        source = MmapSource(f)
        reader = Reader(source)
        
        meta = reader.metadata()
        print(f"✅ PMTiles Version: {meta.get('version', '?')}")
        print(f"📐 Bounds: {meta.get('bounds', 'Unknown')}")
        
        places = {}
        # Priority map for sorting (City > Town > Village etc)
        PLACE_CLASS_PRIORITY = {
            'city': 1, 'town': 2, 'village': 3,
            'suburb': 4, 'neighbourhood': 5, 'quarter': 5,
            'hamlet': 6, 'locality': 7,
        }
        
        decode_stats = {"success": 0, "failed": 0}
        
        # Zoom levels to scan (Tunisia fits well in these ranges)
        zoom_levels = [8, 10, 12, 14]
        
        for zoom in zoom_levels:
            tiles = tiles_for_bbox(zoom, 9.5, 36.3, 11.0, 37.4)
            print(f"  🔍 Scanning z{zoom} ({len(tiles)} tiles)...")
            
            # Limit loop for testing/debugging
            max_tiles_debug = 5000 if zoom > 10 else 5000 
            
            for i, (tx, ty) in enumerate(tiles):
                if i >= max_tiles_debug:
                    break
                    
                tile_data = reader.get(zoom, tx, ty)
                if not tile_data:
                    continue
                
                decoded, method = try_decode_tile(tile_data)
                if decoded is None:
                    decode_stats["failed"] += 1
                    continue
                
                decode_stats["success"] += 1
                
                # Check relevant layers
                for layer_name in ['place', 'poi']:
                    if layer_name not in decoded:
                        continue
                    
                    layer = decoded[layer_name]
                    for feature in layer.get('features', []):
                        props = feature.get('properties', {})
                        geom = feature.get('geometry', {})
                        
                        # Extract Name
                        name = (props.get('name') or props.get('name:en') or 
                               props.get('name:latin') or props.get('name:ar') or '')
                        if not name:
                            continue
                        
                        # Extract Coordinates & Convert to WGS84
                        lon, lat = None, None
                        if geom.get('type') == 'Point' and len(geom.get('coordinates', [])) == 2:
                            px, py = geom['coordinates']
                            lon, lat = mvt_to_wgs84(zoom, tx, ty, px, py)
                        else:
                            continue # Skip non-points
                        
                        if lon is None or lat is None:
                            continue
                            
                        # Classification
                        cls = props.get('class') or props.get('subclass') or ''
                        priority = PLACE_CLASS_PRIORITY.get(cls, 10)
                        
                        # Deduplication Key
                        # Use rounded coordinates to merge duplicates from adjacent tiles
                        key = name.lower().strip() + f"|{round(lat, 2)},{round(lon, 2)}"
                        
                        # Store if new or higher priority
                        if key not in places or priority < places[key].get('_p', 99):
                            places[key] = {
                                'n': name,
                                'nl': props.get('name:en') or props.get('name:latin') or name,
                                'na': props.get('name:ar'),
                                'la': lat,
                                'lo': lon,
                                'c': cls,
                                '_p': priority
                            }
        
        # Finalize and Sort
        result = []
        for v in places.values():
            del v['_p']
            result.append(v)
        result.sort(key=lambda x: (PLACE_CLASS_PRIORITY.get(x['c'], 10), x['n']))
        
        print(f"\n📊 Stats: {decode_stats['success']} tiles decoded successfully.")
        print(f"✨ Extracted {len(result)} unique places.")
        
        # Save JSON
        out = Path('places.json')
        out.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        size = out.stat().st_size / 1024
        print(f"💾 Saved to {out} ({size:.1f} KB)")
        return result

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python extract_places.py path/to/tunis.pmtiles")
        sys.exit(1)
    extract(sys.argv[1])