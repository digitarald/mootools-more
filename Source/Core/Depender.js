/*
Script: Depender.js
	Clientside dependency loader for MooTools.

	License:
		MIT-style license.

	Authors:
		Aaron Newton
*/

var Depender = new Class({

	Implements: [Events, Options],

	options: {
		/* 
		onRequire: $empty(scripts),
		onReady: $empty(loadedScripts),
		onRequirementLoaded: $empty(loadedScripts),
		scriptLoaded: $empty(script, percentOfTotalLoaded, percentOfBatch, loadedScripts),
		*/
		loadedSources: [],
		loadedScripts: ['Core', 'Browser', 'Array', 'String', 'Function', 'Number', 'Hash', 'Element', 'Event', 'Element.Event', 'Class', 'Class.Extras', 'Request', 'JSON', 'Request.JSON', 'More', 'Depender'],
		noCache: false,
		log: false
	},

	initialize: function(libs, options){
		var prev = document.id(window).retrieve('Depender');
		if (prev) return prev.fetchLibs(libs);
		this.setOptions(options);
		if (this.options.log) this.enableLog();
		else this.disableLog();
		document.id(window).store('Depender', this);
		this.fetchLibs(libs);
	},

	enableLog: function(){
		this.log = function(){
			console.log.apply(console, arguments);
			return this;
		};
		this.log('enabling depender log.');
		this.logged.each(function(logged){
			this.log.apply(this, logged);
		}, this);
		this.logged.empty();
	},

	logged:[],

	disableLog: function(){
		this.log = function(){
			this.logged.push(arguments);
			return this;
		};
	},

	loaded: [],

	sources: {},

	libs: {},

	fetchLibs: function(libs) {
		var loader = function(data){
			this.libs = $merge(this.libs, data);
			$each(this.libs, function(data, lib) {
				if (data.scripts) this.loadSource(lib, data.scripts);
			}, this);
		}.bind(this);
		if ($type(libs) == 'string') {
			this.log('fetching libs ', libs);
			this.request(libs, loader);
		} else {
			loader(libs);
		}
	},

	require: function(){
		this.fireEvent('require', [$A(arguments)]);
		if (this.mapLoaded) {
			this.loadDependencies.apply(this, arguments);
			return this;
		}
		//if !this.mapLoaded, then fetchLibs is still running and the map isn't loaded
		var fetcher = function(){
			this.require.apply(this, arguments);
			this.removeEvent('mapLoaded', fetcher);
		}.bind(this, arguments);

		this.addEvent('mapLoaded', fetcher);
		return this;
	},

	requireSources: function() {
		$A(arguments).each(function(source){
			this.require.apply(this, this.libs[source].files)
		}, this);
	},

	cleanDoubleSlash: function(str){
		if (!str) return str;
		var prefix = '';
		if (str.test(/^http:\/\//)) {
			prefix = 'http://';
			str = str.substring(7, str.length);
		}
		str = str.replace(/\/\//g, '/');
		return prefix + str;
	},

	request: function(url, callback) {
		new Request.JSON({
			url: url,
			secure: false,
			onSuccess: callback
		}).send();
	},

	loadSource: function(lib, source){
		if (this.libs[lib].files) return this.dataLoaded();
		this.log('loading source: ', source);
		this.request(this.cleanDoubleSlash(source + '/scripts.json'), function(result){
			this.libs[lib].files = result;
			this.dataLoaded();
		}.bind(this));
	},

	//manage loaded data
	dataLoaded: function(){
		var loaded = true;
		$each(this.libs, function(v, k) {
			if (!this.libs[k].files) loaded = false;
		}, this);
		if (loaded) {
			this.mapTree();
			this.mapLoaded = true;
			this.calculateLoaded();
			this.fireEvent('mapLoaded');
		}
	},

	calculateLoaded: function(){
		var set = function(script) {
			this.loadedScripts[script] = true;
		}.bind(this);
		if (this.options.loadedScripts) this.options.loadedScripts.each(set);
		if (this.options.loadedSources) {
			this.options.loadedSources.each(function(lib) {
				$each(this.libs[lib].files, function(dir) {
					$each(dir, function(data, file){
						set(file);
					}, this);
				}, this);
			}, this);
		}
	},

	//map dependencies
	deps: {},

	pathMap: {},

	//create a map of source to paths
	mapTree: function(){
		$each(this.libs, function(data, source){
			$each(data.files, function(scripts, folder){
				$each(scripts, function(details, script){
					this.deps[source+':'+folder+':'+script] = details.deps;
					this.pathMap[script] = source+':'+folder+':'+script;
				}, this);
			}, this);
		}, this);
		this.log('dependencies mapped: ', this.deps);
	},

	//get the dependencies for a given script
	getDepsForScript: function(script){
		return this.deps[this.pathMap[script]] || [];
	},

	//calculate the dependencies for a given script
	calculateDependencies: function(script){
		var reqs = [];
		if (script == 'None' || !script) return reqs;
		var deps = this.getDepsForScript(script);
		if (!deps) {
			if (window.console && console.warn) console.warn('dependencies not mapped: script: %o, map: %o, :deps: %o', script, this.pathMap, this.deps);
		} else {
			deps.each(function(scr){
				if (scr == script || scr == 'None' || !scr) return;
				if (!reqs.contains(scr)) reqs.combine(this.calculateDependencies(scr));
				reqs.include(scr);
			}, this);
			return reqs;
		}
	},

	//get the path for a script
	getPath: function(script){
		try {
			var chunks = this.pathMap[script].split(':');
			var dir = this.libs[chunks[0]].scripts + '/';
			chunks.erase(chunks[0]);
			return this.cleanDoubleSlash(dir + chunks.join('/') + '.js');
		} catch(e){
			return script;
		}
	},

	//load the missing dependencies for a given script
	loadDependencies: function(){
		$each(arguments, function(script){
			var scripts = this.calculateDependencies(script).include(script);
			scripts = scripts.filter(function(s){return !this.loadedScripts.get(s)}, this);
			scripts.each(function(scr) {
				this.loadedScripts[scr] = this.loadedScripts.get(scr) || false;
			}, this);
			if (scripts.length) {
				scripts.filter(function(scr){
					return scr != 'None'
				}).each(function(scr){
					this.load(scr);
				}.bind(this));
			} else {
				this.ready();
			}
		}, this);
	},

	toLoad: [],

	load: function(script) {
		var finish = function() {
			this.loading = false;
			this.scriptLoaded(script);
			if (this.toLoad.length) this.load(this.toLoad.shift());
		}.bind(this);
		if (this.loading) return this.toLoad.push(script);
		this.loading = true;
		this.log('loading script: ', script);
		var error = function() {
			this.log('could not load: ', script);
		}.bind(this);
		new Request({
			url: this.getPath(script),
			noCache: this.options.noCache,
			onComplete: function(js) {
				this.log('loaded script: ', script);
				$exec(js);
				finish.delay(50, this);
			}.bind(this),
			onFailure: error,
			onException: error
		}).send();
	},

	loadedScripts: $H({}),

	scriptLoaded: function(script) {
		this.loadedScripts[script] = true;
		var ready = true;
		var loaded = this.loadedScripts.filter(function(loaded, scr) {
			if (!loaded) ready = false;
			return loaded;
		}, this);
		//passed the script loaded, the % loaded of total dependencies, the % of the current batch, and an array of the loaded scripts.
		this.fireEvent('scriptLoaded', [script, loaded.length / this.loadedScripts.getKeys() * 100, loaded.length - this.lastLoaded / this.loadedScripts.getKeys() * 100, loaded]);
		if (ready) this.ready();
	},

	lastLoaded: 0,

	ready: function(){
		var loaded = this.loadedScripts.getKeys();
		this.fireEvent('ready', loaded);
		this.lastLoaded = loaded.length;
		this.removeEvents('ready');
		this.addEvent('ready', function(scripts){
			this.fireEvent('requirementLoaded', scripts);
		}.bind(this));
	}

});