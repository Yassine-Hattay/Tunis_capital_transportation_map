package tn.atlas.maps

import android.content.Context
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors

@CapacitorPlugin(name = "Valhalla")
class ValhallaPlugin : Plugin() {

    private val executor = Executors.newSingleThreadExecutor()

    // These are set once in initEngine() and reused for every route() call
    private var configJson: String? = null   // the patched valhalla.json content
    private var engineInstance: Any? = null  // ValhallaKotlin instance (held via reflection)
    private var routeMethod: java.lang.reflect.Method? = null // ValhallaKotlin.route(String,String)

    // ── Auto-init on plugin load ──────────────────────────────────────────────
    override fun load() {
        executor.execute {
            try {
                initEngine()
            } catch (e: Exception) {
                android.util.Log.e("ValhallaPlugin", "Init failed: ${e.message}", e)
            }
        }
    }

    // ── JS-callable initialize() for an explicit ready callback ──────────────
    @PluginMethod
    fun initialize(call: PluginCall) {
        if (engineInstance != null) { call.resolve(); return }
        executor.execute {
            try {
                initEngine()
                call.resolve()
            } catch (e: Exception) {
                call.reject("Init failed: ${e.message}")
            }
        }
    }

    // ── Route ─────────────────────────────────────────────────────────────────
    @PluginMethod
    fun route(call: PluginCall) {
        val start   = call.getObject("start")
        val end     = call.getObject("end")
        val profile = call.getString("profile") ?: "pedestrian"

        if (start == null || end == null) { call.reject("Missing start or end"); return }

        val cfg = configJson
        val eng = engineInstance
        val mth = routeMethod

        executor.execute {
            try {
                val requestJson = JSONObject().apply {
                    put("locations", JSONArray().apply {
                        put(JSONObject().apply {
                            put("lat", start.getDouble("lat"))
                            put("lon", start.getDouble("lon"))
                        })
                        put(JSONObject().apply {
                            put("lat", end.getDouble("lat"))
                            put("lon", end.getDouble("lon"))
                        })
                    })
                    put("costing", profile)
                    put("directions_options", JSONObject().apply {
                        put("units", "kilometers")
                    })
                }.toString()

                // Use reflection to call ValhallaKotlin.route(configJson, requestJson)
                // which is the native JNI bridge: internal in the library but reachable via reflection
                val resultJson: String = if (eng != null && mth != null && cfg != null) {
                    android.util.Log.i("ValhallaPlugin", "Calling real Valhalla engine…")
                    android.util.Log.i("ValhallaPlugin", "CONFIG FILE CONTENTS: ${File(cfg).readText()}")

                    val raw = mth.invoke(eng, requestJson, cfg) as String  // ← cfg, not ""
                    android.util.Log.i("ValhallaPlugin", "RAW RESPONSE (empty config): $raw")
                    raw
                } else {
                    android.util.Log.w("ValhallaPlugin", "Engine not ready — returning mock route")
                    mockRoute(start.getDouble("lat"), start.getDouble("lon"),
                        end.getDouble("lat"),   end.getDouble("lon"))
                }

                val result   = JSONObject(resultJson)
                val trip     = result.optJSONObject("trip")
                val summary  = trip?.optJSONObject("summary")
                val firstLeg = trip?.optJSONArray("legs")?.optJSONObject(0)
                val shape    = firstLeg?.optString("shape")

                if (shape.isNullOrEmpty()) {
                    call.reject("No route geometry returned")
                    return@execute
                }

                val instructions = JSONArray()
                firstLeg.optJSONArray("maneuvers")?.let { maneuvers ->
                    for (i in 0 until maneuvers.length()) {
                        val m = maneuvers.getJSONObject(i)
                        instructions.put(JSONObject().apply {
                            put("instruction", m.optString("instruction"))
                            put("distance",    m.optDouble("length"))
                            put("time",        m.optInt("time"))
                            put("type",        m.optInt("type"))
                        })
                    }
                }

                val response = JSObject()
                response.put("distance",     summary?.optDouble("length") ?: 0.0)
                response.put("duration",     summary?.optInt("time") ?: 0)
                response.put("geometry",     shape)
                response.put("instructions", instructions)

                call.resolve(response)

            } catch (e: Exception) {
                android.util.Log.e("ValhallaPlugin", "Routing failed: ${e.message}", e)
                call.reject("Routing failed: ${e.message}")
            }
        }
    }

    // ── Engine init via reflection ────────────────────────────────────────────

    private fun initEngine() {
        val ctx = context ?: return
        val valhallaDir = File(ctx.filesDir, "valhalla").apply { mkdirs() }
        val tilesDest  = File(valhallaDir, "tiles.tar")
        val configDest = File(valhallaDir, "valhalla.json")

        // Extract tiles.tar once (can be large)
        if (!tilesDest.exists()) {
            android.util.Log.i("ValhallaPlugin", "Extracting tiles.tar…")
            ctx.assets.open("public/valhala/tiles.tar").use { input ->
                FileOutputStream(tilesDest).use { output -> input.copyTo(output) }
            }
            android.util.Log.i("ValhallaPlugin", "Extracted ${tilesDest.length()} bytes")
        }

        // Write + patch valhalla.json so tile_extract points to on-device path
        ctx.assets.open("public/valhala/valhalla.json").use { input ->
            FileOutputStream(configDest).use { output -> input.copyTo(output) }
        }
        patchConfig(configDest, tilesDest.absolutePath)
        configJson = configDest.absolutePath

        // ── Reflection: reach ValhallaKotlin even though it's marked internal ──
        // ValhallaKotlin is the JNI bridge: route(configJson: String, requestJson: String): String
        // It's internal to the library module but accessible at runtime via reflection.
        try {
            val cls = Class.forName("com.valhalla.valhalla.ValhallaKotlin")

            // ValhallaKotlin$Companion holds the static init that loads libvalhalla-wrapper.so
            // Instantiating the main class triggers the static{} block which loads the .so
            val instance = cls.getDeclaredConstructor().apply { isAccessible = true }.newInstance()

            // Get the route method: route(String configJson, String requestJson): String
            val method = cls.getDeclaredMethod("route", String::class.java, String::class.java)
                .apply { isAccessible = true }

            engineInstance = instance
            routeMethod    = method

            android.util.Log.i("ValhallaPlugin", "✓ ValhallaKotlin engine ready via reflection")

        } catch (e: Exception) {
            // Library changed or reflection blocked — fall back to mock routing
            android.util.Log.w("ValhallaPlugin",
                "Reflection init failed (${e.message}) — mock routing active")
            engineInstance = null
            routeMethod    = null
        }
    }

    // ── Config patching ───────────────────────────────────────────────────────

    private fun patchConfig(configFile: File, tilesAbsPath: String) {
        val patched = configFile.readText().replace(
            Regex(""""tile_extract"\s*:\s*"[^"]*""""),
            """"tile_extract": "$tilesAbsPath""""
        )
        configFile.writeText(patched)
        android.util.Log.i("ValhallaPlugin", "Config patched: tile_extract → $tilesAbsPath")
    }

    // ── Mock fallback (used when engine init fails) ───────────────────────────
    // Returns a minimal valid Valhalla JSON response so the JS layer
    // always gets something back in the expected shape.

    private fun mockRoute(fromLat: Double, fromLon: Double, toLat: Double, toLon: Double): String {
        // Encode a straight 2-point line between the two locations as polyline6
        val shape = encodePolyline6(listOf(
            Pair(fromLat, fromLon),
            Pair(toLat, toLon)
        ))
        val distKm = haversineKm(fromLat, fromLon, toLat, toLon)
        val timeSec = (distKm / 5.0 * 3600).toInt() // ~5 km/h walk speed

        return JSONObject().apply {
            put("trip", JSONObject().apply {
                put("summary", JSONObject().apply {
                    put("length", distKm)
                    put("time",   timeSec)
                })
                put("legs", JSONArray().apply {
                    put(JSONObject().apply {
                        put("shape", shape)
                        put("maneuvers", JSONArray().apply {
                            put(JSONObject().apply {
                                put("instruction", "Head toward destination (mock route)")
                                put("length", distKm)
                                put("time",   timeSec)
                                put("type",   1)
                            })
                        })
                    })
                })
            })
        }.toString()
    }

    // Encode a list of (lat,lon) pairs as a polyline6 string (Valhalla format)
    private fun encodePolyline6(points: List<Pair<Double, Double>>): String {
        fun encodeValue(v: Int): String {
            var n = if (v < 0) (v shl 1).inv() else v shl 1
            val sb = StringBuilder()
            while (n >= 0x20) {
                sb.append(((0x20 or (n and 0x1f)) + 63).toChar())
                n = n ushr 5
            }
            sb.append((n + 63).toChar())
            return sb.toString()
        }
        val sb = StringBuilder()
        var prevLat = 0; var prevLon = 0
        for ((lat, lon) in points) {
            val iLat = Math.round(lat * 1e6).toInt()
            val iLon = Math.round(lon * 1e6).toInt()
            sb.append(encodeValue(iLat - prevLat))
            sb.append(encodeValue(iLon - prevLon))
            prevLat = iLat; prevLon = iLon
        }
        return sb.toString()
    }

    // Straight-line distance in km between two lat/lon points
    private fun haversineKm(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val R = 6371.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = Math.sin(dLat / 2).let { it * it } +
                Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
                Math.sin(dLon / 2).let { it * it }
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    }
}