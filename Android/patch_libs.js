var fs = require('fs');

function patch(path) {
    console.log('Patching ' + path);
    var content = fs.readFileSync(path, 'utf8');

    // Replace rest parameters in functions: function(a,...b) -> function(a)
    // and inject var b = Array.prototype.slice.call(arguments, n)
    // This is hard for minified code.

    // Simpler: replace common ES6 syntax that crashes the parser
    // Replace arrow functions () => with function() {}
    // (Note: this breaks 'this' binding, but many minified libs don't rely on lexical this in top-level functions)
    content = content.replace(/([a-zA-Z0-9_$]+)=>([^{;]+)/g, 'function($1){return $2}');
    content = content.replace(/\(\)=>([^{;]+)/g, 'function(){return $1}');

    // Replace const/let with var
    content = content.replace(/\bconst\b/g, 'var');
    content = content.replace(/\blet\b/g, 'var');

    // Replace spread operator in objects/arrays - VERY HARD to do via regex
    // Replace rest parameters ...args - Also hard.

    // Let's try to just fix the one at line 42 in maplibre-gl.js
    // function g(t,...e){for(const r of e)for(const e in r)t[e]=r[e];return t}
    content = content.replace(/function g\(t,\.\.\.e\)\{for\(var r of e\)for\(var e in r\)t\[e\]=r\[e\];return t\}/g,
                             'function g(t){var e=Array.prototype.slice.call(arguments,1);for(var i=0;i<e.length;i++){var r=e[i];for(var key in r)t[key]=r[key];}return t}');

    // Replace other for...of loops
    content = content.replace(/for\(var ([a-zA-Z0-9_$]+) of ([a-zA-Z0-9_$]+)\)/g,
                             'for(var _i=0, _arr=$2; _i<_arr.length; _i++){var $1=_arr[_i];');

    fs.writeFileSync(path, content);
}

patch('C:/Users/hatta/Desktop/presonal-projects/Tunis_transport_map/code/Android/web/lib/maplibre-gl.js');
patch('C:/Users/hatta/Desktop/presonal-projects/Tunis_transport_map/code/Android/web/lib/pmtiles.js');
