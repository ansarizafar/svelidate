var app = (function () {
	'use strict';

	function noop() {}

	function addLoc(element, file, line, column, char) {
		element.__svelte_meta = {
			loc: { file, line, column, char }
		};
	}

	function run(fn) {
		return fn();
	}

	function blankObject() {
		return Object.create(null);
	}

	function run_all(fns) {
		fns.forEach(run);
	}

	function is_function(thing) {
		return typeof thing === 'function';
	}

	function safe_not_equal(a, b) {
		return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
	}

	function validate_store(store, name) {
		if (!store || typeof store.subscribe !== 'function') {
			throw new Error(`'${name}' is not a store with a 'subscribe' method`);
		}
	}

	function append(target, node) {
		target.appendChild(node);
	}

	function insert(target, node, anchor) {
		target.insertBefore(node, anchor);
	}

	function detachNode(node) {
		node.parentNode.removeChild(node);
	}

	function createElement(name) {
		return document.createElement(name);
	}

	function createText(data) {
		return document.createTextNode(data);
	}

	function createComment() {
		return document.createComment('');
	}

	function addListener(node, event, handler, options) {
		node.addEventListener(event, handler, options);
		return () => node.removeEventListener(event, handler, options);
	}

	function children (element) {
		return Array.from(element.childNodes);
	}

	function setData(text, data) {
		text.data = '' + data;
	}

	let current_component;

	function set_current_component(component) {
		current_component = component;
	}

	function get_current_component() {
		if (!current_component) throw new Error(`Function called outside component initialization`);
		return current_component;
	}

	function beforeUpdate(fn) {
		get_current_component().$$.before_render.push(fn);
	}

	function onMount(fn) {
		get_current_component().$$.on_mount.push(fn);
	}

	function afterUpdate(fn) {
		get_current_component().$$.after_render.push(fn);
	}

	function onDestroy(fn) {
		get_current_component().$$.on_destroy.push(fn);
	}

	function createEventDispatcher() {
		const component = current_component;

		return (type, detail) => {
			const callbacks = component.$$.callbacks[type];

			if (callbacks) {
				// TODO are there situations where events could be dispatched
				// in a server (non-DOM) environment?
				const event = new window.CustomEvent(type, { detail });
				callbacks.slice().forEach(fn => {
					fn.call(component, event);
				});
			}
		};
	}

	function setContext(key, context) {
		get_current_component().$$.context.set(key, context);
	}

	function getContext(key) {
		return get_current_component().$$.context.get(key);
	}

	let dirty_components = [];

	let update_promise;
	const binding_callbacks = [];
	const render_callbacks = [];

	function schedule_update() {
		if (!update_promise) {
			update_promise = Promise.resolve();
			update_promise.then(flush);
		}
	}

	function add_render_callback(fn) {
		render_callbacks.push(fn);
	}

	function tick() {
		schedule_update();
		return update_promise;
	}

	function flush() {
		const seen_callbacks = new Set();

		do {
			// first, call beforeUpdate functions
			// and update components
			while (dirty_components.length) {
				const component = dirty_components.shift();
				set_current_component(component);
				update(component.$$);
			}

			while (binding_callbacks.length) binding_callbacks.shift()();

			// then, once components are updated, call
			// afterUpdate functions. This may cause
			// subsequent updates...
			while (render_callbacks.length) {
				const callback = render_callbacks.pop();
				if (!seen_callbacks.has(callback)) {
					callback();

					// ...so guard against infinite loops
					seen_callbacks.add(callback);
				}
			}
		} while (dirty_components.length);

		update_promise = null;
	}

	function update($$) {
		if ($$.fragment) {
			$$.update($$.dirty);
			run_all($$.before_render);
			$$.fragment.p($$.dirty, $$.ctx);
			$$.dirty = null;

			$$.after_render.forEach(add_render_callback);
		}
	}

	function mount_component(component, target, anchor) {
		const { fragment, on_mount, on_destroy, after_render } = component.$$;

		fragment.m(target, anchor);

		// onMount happens after the initial afterUpdate. Because
		// afterUpdate callbacks happen in reverse order (inner first)
		// we schedule onMount callbacks before afterUpdate callbacks
		add_render_callback(() => {
			const new_on_destroy = on_mount.map(run).filter(is_function);
			if (on_destroy) {
				on_destroy.push(...new_on_destroy);
			} else {
				// Edge case — component was destroyed immediately,
				// most likely as a result of a binding initialising
				run_all(new_on_destroy);
			}
			component.$$.on_mount = [];
		});

		after_render.forEach(add_render_callback);
	}

	function destroy(component, detach) {
		if (component.$$) {
			run_all(component.$$.on_destroy);
			component.$$.fragment.d(detach);

			// TODO null out other refs, including component.$$ (but need to
			// preserve final state?)
			component.$$.on_destroy = component.$$.fragment = null;
			component.$$.ctx = {};
		}
	}

	function make_dirty(component, key) {
		if (!component.$$.dirty) {
			dirty_components.push(component);
			schedule_update();
			component.$$.dirty = {};
		}
		component.$$.dirty[key] = true;
	}

	function init(component, options, instance, create_fragment, not_equal$$1) {
		const parent_component = current_component;
		set_current_component(component);

		const props = options.props || {};

		const $$ = component.$$ = {
			fragment: null,
			ctx: null,

			// state
			update: noop,
			not_equal: not_equal$$1,
			bound: blankObject(),

			// lifecycle
			on_mount: [],
			on_destroy: [],
			before_render: [],
			after_render: [],
			context: new Map(parent_component ? parent_component.$$.context : []),

			// everything else
			callbacks: blankObject(),
			dirty: null
		};

		let ready = false;

		$$.ctx = instance
			? instance(component, props, (key, value) => {
				if ($$.bound[key]) $$.bound[key](value);

				if ($$.ctx) {
					const changed = not_equal$$1(value, $$.ctx[key]);
					if (ready && changed) {
						make_dirty(component, key);
					}

					$$.ctx[key] = value;
					return changed;
				}
			})
			: props;

		$$.update();
		ready = true;
		run_all($$.before_render);
		$$.fragment = create_fragment($$.ctx);

		if (options.target) {
			if (options.hydrate) {
				$$.fragment.l(children(options.target));
			} else {
				$$.fragment.c();
			}

			if (options.intro && component.$$.fragment.i) component.$$.fragment.i();
			mount_component(component, options.target, options.anchor);
			flush();
		}

		set_current_component(parent_component);
	}

	class SvelteComponent {
		$destroy() {
			destroy(this, true);
			this.$destroy = noop;
		}

		$on(type, callback) {
			const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
			callbacks.push(callback);

			return () => {
				const index = callbacks.indexOf(callback);
				if (index !== -1) callbacks.splice(index, 1);
			};
		}

		$set() {
			// overridden by instance, if it has props
		}
	}

	class SvelteComponentDev extends SvelteComponent {
		constructor(options) {
			if (!options || (!options.target && !options.$$inline)) {
				throw new Error(`'target' is a required option`);
			}

			super();
		}

		$destroy() {
			super.$destroy();
			this.$destroy = () => {
				console.warn(`Component was already destroyed`);
			};
		}
	}

	var commonjsGlobal = typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

	function unwrapExports (x) {
		return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x.default : x;
	}

	function createCommonjsModule(fn, module) {
		return module = { exports: {} }, fn(module, module.exports), module.exports;
	}

	function getCjsExportFromNamespace (n) {
		return n && n.default || n;
	}

	var validator = createCommonjsModule(function (module, exports) {
	!function(n,e){module.exports=e();}(commonjsGlobal,function(){function n(n,e){if(!function(n){return null!==n&&"object"==typeof n}(n)||"string"!=typeof e)return n;for(var r=e.split("."),t=0;t<r.length;t++){var i=r[t];if(null===(n=n.hasOwnProperty(i)?n[i]:null))break}return n}function e(n){this.fn=n,this._promise=null;}e.prototype.then=function(n,e){return this._promise=this._promise||new Promise(this.fn),this._promise.then(n,e)},e.prototype.catch=function(n){return this._promise=this._promise||new Promise(this.fn),this._promise.catch(n)};var r=function(n,e){e.add();for(var r=n.length,t=0,i="name";t<r;){var o=n[t++],u=o.charCodeAt(0);58===u||44===u?(i="arg",e.shiftValue()):124===u?(i="name",e.add()):"arg"===i?e.appendValue(o):e.appendKey(o,u);}return e.toJSON()};var t=function(){return {nodes:[],currentNode:null,add:function(){this.currentNode={name:"",args:[]},this.nodes.push(this.currentNode);},appendKey:function(n,e){32!==e&&(this.currentNode.name+=n);},appendValue:function(n){this.currentNode.args[this.currentNode.args.length-1]+=n;},shiftValue:function(){this.currentNode.args.push("");},toJSON:function(){return this.nodes}}};function i(e,i){return i=i||{},Object.keys(e).reduce(function(o,u){var a=e[u];if("string"==typeof a)a=r(a,new t);else if(!Array.isArray(a))throw new Error("Rules must be defined as a string or an array");u.indexOf("*")>-1?function e(r,t,i,o){if(!t)return [];i=i||0;var u=r[i++],a=r[i];return o||(o=[u],u=""),o=o.reduce(function(e,r){var i=u?r+"."+u:r;if(void 0!==a){var o=n(t,i);if(Array.isArray(o))for(var f=o.length,s=0;s<f;s++)e.push(i+"."+s);}else e.push(i);return e},[]),i===r.length?o:e(r,t,i,o)}(u.split(/\.\*\.?/),i).forEach(function(n){o[n]=a;}):o[u]=a;return o},{})}var o=function(n){return n.replace(/_(\w)/g,function(n,e){return e.toUpperCase()})};function u(e,r,t,i){var u=r.replace(/\.\d/g,".*"),a=o(t),f=e[u+"."+t]||e[u+"."+a]||e[t]||e[a]||"{{validation}} validation failed on {{ field }}";return "function"==typeof f?f(u,t,i):function(e,r,t){t=t||{skipUndefined:!1,throwOnUndefined:!1};for(var i,o=/{{2}(.+?)}{2}/g,u=e;null!==(i=o.exec(e));){var a=i[1].trim();if(a){var f=n(r,a);if(void 0!==f&&null!==f)u=u.replace(i[0],f);else{if(t.throwOnUndefined){var s=new Error("Missing value for "+i[0]);throw s.key=a,s.code="E_MISSING_KEY",s}t.skipUndefined||(u=u.replace(i[0],""));}}}return u}(f,{field:r,validation:t,argument:i})}function a(r,t,i,a,f){return Object.keys(t).reduce(function(s,c){return t[c].map(function(t){s.push(function(r,t,i,a,f,s){var c=t.name,d=t.args;return new e(function(e,t){var l=o(c),h=r[l];if("function"!=typeof h){var p=new Error(l+" is not defined as a validation rule");return s.addError(p,i,l,d),void t(p)}h(a,i,u(f,i,c,d),d,n).then(e).catch(function(n){s.addError(n,i,l,d),t(n);});})}(r,t,c,i,a,f));}),s},[])}function f(n,e,r,t,o,u){return new Promise(function(f,s){o=o||{};var c=i(t,r);(function(n,e){var r=[],t=n.length;return function e(i,o){return i>=t?Promise.resolve(r):n[i].then(function(n){return r.push(function(n){return {fullFilled:!0,rejected:!1,value:n,reason:null}}(n)),e(i+1,o)}).catch(function(n){return r.push(function(n){return {fullFilled:!1,rejected:!0,value:null,reason:n}}(n)),o?Promise.resolve(r):e(i+1,o)})}(0,e)})(a(n,c,r,o,u),e).then(function(n){var e=u.toJSON();if(e)return s(e);f(r);});})}return function(n,e){var r="Cannot instantiate validator without";if(!n)throw new Error(r+" validations");if(!e)throw new Error(r+" error formatter");return {validate:function(r,t,i,o){return o=new(o||e),f(n,!0,r,t,i,o)},validateAll:function(r,t,i,o){return o=new(o||e),f(n,!1,r,t,i,o)}}}});
	});

	var formatters = createCommonjsModule(function (module, exports) {
	!function(r,e){e(exports);}(commonjsGlobal,function(r){function e(){this.errors=[];}function t(){this.errors=[];}e.prototype.addError=function(r,e,t,o){var i=r;r instanceof Error&&(t="ENGINE_EXCEPTION",i=r.message),this.errors.push({message:i,field:e,validation:t});},e.prototype.toJSON=function(){return this.errors.length?this.errors:null},t.prototype.addError=function(r,e,t,o){var i=r;r instanceof Error&&(t="ENGINE_EXCEPTION",i=r.message),this.errors.push({title:t,detail:i,source:{pointer:e}});},t.prototype.toJSON=function(){return this.errors.length?{errors:this.errors}:null},r.Vanilla=e,r.JsonApi=t,Object.defineProperty(r,"__esModule",{value:!0});});
	});

	unwrapExports(formatters);

	function readable(start, value) {
		const subscribers = [];
		let stop;

		function set(newValue) {
			if (newValue === value) return;
			value = newValue;
			subscribers.forEach(s => s[1]());
			subscribers.forEach(s => s[0](value));
		}

		return {
			subscribe(run$$1, invalidate = noop) {
				if (subscribers.length === 0) {
					stop = start(set);
				}

				const subscriber = [run$$1, invalidate];
				subscribers.push(subscriber);
				run$$1(value);

				return function() {
					const index = subscribers.indexOf(subscriber);
					if (index !== -1) subscribers.splice(index, 1);

					if (subscribers.length === 0) {
						stop && stop();
						stop = null;
					}
				};
			}
		};
	}

	function writable(value) {
		const subscribers = [];

		function set(newValue) {
			if (newValue === value) return;
			value = newValue;
			subscribers.forEach(s => s[1]());
			subscribers.forEach(s => s[0](value));
		}

		function update(fn) {
			set(fn(value));
		}

		function subscribe(run$$1, invalidate = noop) {
			const subscriber = [run$$1, invalidate];
			subscribers.push(subscriber);
			run$$1(value);

			return () => {
				const index = subscribers.indexOf(subscriber);
				if (index !== -1) subscribers.splice(index, 1);
			};
		}

		return { set, update, subscribe };
	}

	function derive(stores, fn) {
		const single = !Array.isArray(stores);
		if (single) stores = [stores];

		const auto = fn.length === 1;
		let value = {};

		return readable(set => {
			let inited = false;
			const values = [];

			let pending = 0;

			const sync = () => {
				if (pending) return;
				const result = fn(single ? values[0] : values, set);
				if (auto && (value !== (value = result))) set(result);
			};

			const unsubscribers = stores.map((store, i) => store.subscribe(
				value => {
					values[i] = value;
					pending &= ~(1 << i);
					if (inited) sync();
				},
				() => {
					pending |= (1 << i);
				})
			);

			inited = true;
			sync();

			return function stop() {
				run_all(unsubscribers);
			};
		});
	}

	var store = /*#__PURE__*/Object.freeze({
		readable: readable,
		writable: writable,
		derive: derive
	});



	var svelte = /*#__PURE__*/Object.freeze({
		onMount: onMount,
		onDestroy: onDestroy,
		beforeUpdate: beforeUpdate,
		afterUpdate: afterUpdate,
		setContext: setContext,
		getContext: getContext,
		tick: tick,
		createEventDispatcher: createEventDispatcher
	});

	var validations = createCommonjsModule(function (module, exports) {
	!function(e,r){r(exports);}(commonjsGlobal,function(e){var r=function(e){return new Promise(function(r,t){var n=e();if(n)return t(n);r("validation passed");})},n=function(e){return "string"==typeof e?e.trim().length>0:null!==e&&void 0!==e},u=function(e){return !n(e)},o="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(e){return typeof e}:function(e){return e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},i=function(){return function(e,r){if(Array.isArray(e))return e;if(Symbol.iterator in Object(e))return function(e,r){var t=[],n=!0,u=!1,o=void 0;try{for(var i,a=e[Symbol.iterator]();!(n=(i=a.next()).done)&&(t.push(i.value),!r||t.length!==r);n=!0);}catch(e){u=!0,o=e;}finally{try{!n&&a.return&&a.return();}finally{if(u)throw o}}return t}(e,r);throw new TypeError("Invalid attempt to destructure non-iterable instance")}}(),a=/^[a-z]+$/i,f=/^[a-z0-9]+$/i;function c(e){return e&&e.__esModule&&Object.prototype.hasOwnProperty.call(e,"default")?e.default:e}function s(e,r){return e(r={exports:{}},r.exports),r.exports}var l=s(function(e,r){Object.defineProperty(r,"__esModule",{value:!0}),r.default=function(e){if(!("string"==typeof e||e instanceof String))throw new TypeError("This library (validator.js) validates strings only")},e.exports=r.default;});c(l);var d=s(function(e,r){Object.defineProperty(r,"__esModule",{value:!0}),r.default=function(){var e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{},r=arguments[1];for(var t in r)void 0===e[t]&&(e[t]=r[t]);return e},e.exports=r.default;});c(d);var v=s(function(e,r){Object.defineProperty(r,"__esModule",{value:!0});var t="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(e){return typeof e}:function(e){return e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e};r.default=function(e,r){(0, u.default)(e);var n=void 0,o=void 0;"object"===(void 0===r?"undefined":t(r))?(n=r.min||0,o=r.max):(n=arguments[1],o=arguments[2]);var i=encodeURI(e).split(/%..|./).length-1;return i>=n&&(void 0===o||i<=o)};var n,u=(n=l)&&n.__esModule?n:{default:n};e.exports=r.default;});c(v);var m=s(function(e,r){Object.defineProperty(r,"__esModule",{value:!0}),r.default=function(e,r){(0, t.default)(e),(r=(0, n.default)(r,o)).allow_trailing_dot&&"."===e[e.length-1]&&(e=e.substring(0,e.length-1));for(var u=e.split("."),i=0;i<u.length;i++)if(u[i].length>63)return !1;if(r.require_tld){var a=u.pop();if(!u.length||!/^([a-z\u00a1-\uffff]{2,}|xn[a-z0-9-]{2,})$/i.test(a))return !1;if(/[\s\u2002-\u200B\u202F\u205F\u3000\uFEFF\uDB40\uDC20]/.test(a))return !1}for(var f,c=0;c<u.length;c++){if(f=u[c],r.allow_underscores&&(f=f.replace(/_/g,"")),!/^[a-z\u00a1-\uffff0-9-]+$/i.test(f))return !1;if(/[\uff01-\uff5e]/.test(f))return !1;if("-"===f[0]||"-"===f[f.length-1])return !1}return !0};var t=u(l),n=u(d);function u(e){return e&&e.__esModule?e:{default:e}}var o={require_tld:!0,allow_underscores:!1,allow_trailing_dot:!1};e.exports=r.default;});c(m);var g=s(function(e,r){Object.defineProperty(r,"__esModule",{value:!0}),r.default=function e(r){var t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:"";(0, n.default)(r);t=String(t);if(!t)return e(r,4)||e(r,6);if("4"===t){if(!u.test(r))return !1;var i=r.split(".").sort(function(e,r){return e-r});return i[3]<=255}if("6"===t){var a=r.split(":"),f=!1,c=e(a[a.length-1],4),s=c?7:8;if(a.length>s)return !1;if("::"===r)return !0;"::"===r.substr(0,2)?(a.shift(),a.shift(),f=!0):"::"===r.substr(r.length-2)&&(a.pop(),a.pop(),f=!0);for(var l=0;l<a.length;++l)if(""===a[l]&&l>0&&l<a.length-1){if(f)return !1;f=!0;}else if(c&&l===a.length-1);else if(!o.test(a[l]))return !1;return f?a.length>=1:a.length===s}return !1};var t,n=(t=l)&&t.__esModule?t:{default:t};var u=/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,o=/^[0-9A-F]{1,4}$/i;e.exports=r.default;});c(g);var h=c(s(function(e,r){Object.defineProperty(r,"__esModule",{value:!0}),r.default=function(e,r){if((0, t.default)(e),(r=(0, n.default)(r,f)).require_display_name||r.allow_display_name){var a=e.match(c);if(a)e=a[1];else if(r.require_display_name)return !1}var l=e.split("@"),d=l.pop(),v=l.join("@"),m=d.toLowerCase();if(r.domain_specific_validation&&("gmail.com"===m||"googlemail.com"===m)){var g=(v=v.toLowerCase()).split("+")[0];if(!(0, u.default)(g.replace(".",""),{min:6,max:30}))return !1;for(var D=g.split("."),b=0;b<D.length;b++)if(!h.test(D[b]))return !1}if(!(0, u.default)(v,{max:64})||!(0, u.default)(d,{max:254}))return !1;if(!(0, o.default)(d,{require_tld:r.require_tld})){if(!r.allow_ip_domain)return !1;if(!(0, i.default)(d)){if(!d.startsWith("[")||!d.endsWith("]"))return !1;var F=d.substr(1,d.length-2);if(0===F.length||!(0, i.default)(F))return !1}}if('"'===v[0])return v=v.slice(1,v.length-1),r.allow_utf8_local_part?x.test(v):p.test(v);for(var w=r.allow_utf8_local_part?y:s,S=v.split("."),_=0;_<S.length;_++)if(!w.test(S[_]))return !1;return !0};var t=a(l),n=a(d),u=a(v),o=a(m),i=a(g);function a(e){return e&&e.__esModule?e:{default:e}}var f={allow_display_name:!1,require_display_name:!1,allow_utf8_local_part:!0,require_tld:!0},c=/^[a-z\d!#\$%&'\*\+\-\/=\?\^_`{\|}~\.\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]+[a-z\d!#\$%&'\*\+\-\/=\?\^_`{\|}~\,\.\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF\s]*<(.+)>$/i,s=/^[a-z\d!#\$%&'\*\+\-\/=\?\^_`{\|}~]+$/i,h=/^[a-z\d]+$/,p=/^([\s\x01-\x08\x0b\x0c\x0e-\x1f\x7f\x21\x23-\x5b\x5d-\x7e]|(\\[\x01-\x09\x0b\x0c\x0d-\x7f]))*$/i,y=/^[a-z\d!#\$%&'\*\+\-\/=\?\^_`{\|}~\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]+$/i,x=/^([\s\x01-\x08\x0b\x0c\x0e-\x1f\x7f\x21\x23-\x5b\x5d-\x7e\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]|(\\[\x01-\x09\x0b\x0c\x0d-\x7f\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]))*$/i;e.exports=r.default;})),p=function(e,r){return "function"==typeof r.indexOf&&r.indexOf(e)>-1},y=/^(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])(?:\.(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])){3}$/,x=function(e){return y.test(e)},D=/^(?:(?:[0-9a-fA-F:]){1,4}(?:(?::(?:[0-9a-fA-F]){1,4}|:)){2,7})+$/,b=function(e){return D.test(e)},F=function(e){return !n(e)||!(e instanceof Date)&&("object"===(void 0===e?"undefined":o(e))&&0===Object.keys(e).length)};var w=/https?:\/\/(www\.)?([-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-z]{2,63}|localhost)\b([-a-zA-Z0-9@:%_+.~#?&//=]*)/i;var S=function(e){return e instanceof Date},_=36e5,M=6e4,T=2,$=/[T ]/,O=/:/,Y=/^(\d{2})$/,A=[/^([+-]\d{2})$/,/^([+-]\d{3})$/,/^([+-]\d{4})$/],E=/^(\d{4})/,N=[/^([+-]\d{4})/,/^([+-]\d{5})/,/^([+-]\d{6})/],W=/^-(\d{2})$/,H=/^-?(\d{3})$/,I=/^-?(\d{2})-?(\d{2})$/,z=/^-?W(\d{2})$/,k=/^-?W(\d{2})-?(\d{1})$/,j=/^(\d{2}([.,]\d*)?)$/,q=/^(\d{2}):?(\d{2}([.,]\d*)?)$/,Z=/^(\d{2}):?(\d{2}):?(\d{2}([.,]\d*)?)$/,C=/([Z+-].*)$/,G=/^(Z)$/,P=/^([+-])(\d{2})$/,U=/^([+-])(\d{2}):?(\d{2})$/;function X(e,r,t){r=r||0,t=t||0;var n=new Date(0);n.setUTCFullYear(e,0,4);var u=7*r+t+1-(n.getUTCDay()||7);return n.setUTCDate(n.getUTCDate()+u),n}var R=function(e,r){if(S(e))return new Date(e.getTime());if("string"!=typeof e)return new Date(e);var t=(r||{}).additionalDigits;t=null==t?T:Number(t);var n=function(e){var r,t={},n=e.split($);if(O.test(n[0])?(t.date=null,r=n[0]):(t.date=n[0],r=n[1]),r){var u=C.exec(r);u?(t.time=r.replace(u[1],""),t.timezone=u[1]):t.time=r;}return t}(e),u=function(e,r){var t,n=A[r],u=N[r];if(t=E.exec(e)||u.exec(e)){var o=t[1];return {year:parseInt(o,10),restDateString:e.slice(o.length)}}if(t=Y.exec(e)||n.exec(e)){var i=t[1];return {year:100*parseInt(i,10),restDateString:e.slice(i.length)}}return {year:null}}(n.date,t),o=u.year,i=function(e,r){if(null===r)return null;var t,n,u,o;if(0===e.length)return (n=new Date(0)).setUTCFullYear(r),n;if(t=W.exec(e))return n=new Date(0),u=parseInt(t[1],10)-1,n.setUTCFullYear(r,u),n;if(t=H.exec(e)){n=new Date(0);var i=parseInt(t[1],10);return n.setUTCFullYear(r,0,i),n}if(t=I.exec(e)){n=new Date(0),u=parseInt(t[1],10)-1;var a=parseInt(t[2],10);return n.setUTCFullYear(r,u,a),n}if(t=z.exec(e))return o=parseInt(t[1],10)-1,X(r,o);if(t=k.exec(e)){o=parseInt(t[1],10)-1;var f=parseInt(t[2],10)-1;return X(r,o,f)}return null}(u.restDateString,o);if(i){var a,f=i.getTime(),c=0;return n.time&&(c=function(e){var r,t,n;if(r=j.exec(e))return (t=parseFloat(r[1].replace(",",".")))%24*_;if(r=q.exec(e))return t=parseInt(r[1],10),n=parseFloat(r[2].replace(",",".")),t%24*_+n*M;if(r=Z.exec(e)){t=parseInt(r[1],10),n=parseInt(r[2],10);var u=parseFloat(r[3].replace(",","."));return t%24*_+n*M+1e3*u}return null}(n.time)),n.timezone?(s=n.timezone,a=(l=G.exec(s))?0:(l=P.exec(s))?(d=60*parseInt(l[2],10),"+"===l[1]?-d:d):(l=U.exec(s))?(d=60*parseInt(l[2],10)+parseInt(l[3],10),"+"===l[1]?-d:d):0):(a=new Date(f+c).getTimezoneOffset(),a=new Date(f+c+a*M).getTimezoneOffset()),new Date(f+c+a*M)}var s,l,d;return new Date(e)};var J=function(e,r){var t=R(e),n=R(r);return t.getTime()>n.getTime()};var Q=function(e,r){var t=R(e),n=R(r);return t.getTime()<n.getTime()};var B=function(e){var r=R(e),t=new Date(0);return t.setFullYear(r.getFullYear(),0,1),t.setHours(0,0,0,0),t};var L=function(e){var r=R(e);return r.setHours(0,0,0,0),r},V=6e4,K=864e5;var ee=function(e,r){var t=L(e),n=L(r),u=t.getTime()-t.getTimezoneOffset()*V,o=n.getTime()-n.getTimezoneOffset()*V;return Math.round((u-o)/K)};var re=function(e){var r=R(e);return ee(r,B(r))+1};var te=function(e,r){var t=r&&Number(r.weekStartsOn)||0,n=R(e),u=n.getDay(),o=(u<t?7:0)+u-t;return n.setDate(n.getDate()-o),n.setHours(0,0,0,0),n};var ne=function(e){return te(e,{weekStartsOn:1})};var ue=function(e){var r=R(e),t=r.getFullYear(),n=new Date(0);n.setFullYear(t+1,0,4),n.setHours(0,0,0,0);var u=ne(n),o=new Date(0);o.setFullYear(t,0,4),o.setHours(0,0,0,0);var i=ne(o);return r.getTime()>=u.getTime()?t+1:r.getTime()>=i.getTime()?t:t-1};var oe=function(e){var r=ue(e),t=new Date(0);return t.setFullYear(r,0,4),t.setHours(0,0,0,0),ne(t)},ie=6048e5;var ae=function(e){var r=R(e),t=ne(r).getTime()-oe(r).getTime();return Math.round(t/ie)+1};var fe=function(e){if(S(e))return !isNaN(e);throw new TypeError(toString.call(e)+" is not an instance of Date")};var ce=["M","MM","Q","D","DD","DDD","DDDD","d","E","W","WW","YY","YYYY","GG","GGGG","H","HH","h","hh","m","mm","s","ss","S","SS","SSS","Z","ZZ","X","x"];var se=function(e){var r=[];for(var t in e)e.hasOwnProperty(t)&&r.push(t);var n=ce.concat(r).sort().reverse();return new RegExp("(\\[[^\\[]*\\])|(\\\\)?("+n.join("|")+"|.)","g")};var le=function(){var e=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],r=["January","February","March","April","May","June","July","August","September","October","November","December"],t=["Su","Mo","Tu","We","Th","Fr","Sa"],n=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],u=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],o=["AM","PM"],i=["am","pm"],a=["a.m.","p.m."],f={MMM:function(r){return e[r.getMonth()]},MMMM:function(e){return r[e.getMonth()]},dd:function(e){return t[e.getDay()]},ddd:function(e){return n[e.getDay()]},dddd:function(e){return u[e.getDay()]},A:function(e){return e.getHours()/12>=1?o[1]:o[0]},a:function(e){return e.getHours()/12>=1?i[1]:i[0]},aa:function(e){return e.getHours()/12>=1?a[1]:a[0]}};return ["M","D","DDD","d","Q","W"].forEach(function(e){f[e+"o"]=function(r,t){return function(e){var r=e%100;if(r>20||r<10)switch(r%10){case 1:return e+"st";case 2:return e+"nd";case 3:return e+"rd"}return e+"th"}(t[e](r))};}),{formatters:f,formattingTokensRegExp:se(f)}},de={distanceInWords:function(){var e={lessThanXSeconds:{one:"less than a second",other:"less than {{count}} seconds"},xSeconds:{one:"1 second",other:"{{count}} seconds"},halfAMinute:"half a minute",lessThanXMinutes:{one:"less than a minute",other:"less than {{count}} minutes"},xMinutes:{one:"1 minute",other:"{{count}} minutes"},aboutXHours:{one:"about 1 hour",other:"about {{count}} hours"},xHours:{one:"1 hour",other:"{{count}} hours"},xDays:{one:"1 day",other:"{{count}} days"},aboutXMonths:{one:"about 1 month",other:"about {{count}} months"},xMonths:{one:"1 month",other:"{{count}} months"},aboutXYears:{one:"about 1 year",other:"about {{count}} years"},xYears:{one:"1 year",other:"{{count}} years"},overXYears:{one:"over 1 year",other:"over {{count}} years"},almostXYears:{one:"almost 1 year",other:"almost {{count}} years"}};return {localize:function(r,t,n){var u;return n=n||{},u="string"==typeof e[r]?e[r]:1===t?e[r].one:e[r].other.replace("{{count}}",t),n.addSuffix?n.comparison>0?"in "+u:u+" ago":u}}}(),format:le()};var ve={M:function(e){return e.getMonth()+1},MM:function(e){return ge(e.getMonth()+1,2)},Q:function(e){return Math.ceil((e.getMonth()+1)/3)},D:function(e){return e.getDate()},DD:function(e){return ge(e.getDate(),2)},DDD:function(e){return re(e)},DDDD:function(e){return ge(re(e),3)},d:function(e){return e.getDay()},E:function(e){return e.getDay()||7},W:function(e){return ae(e)},WW:function(e){return ge(ae(e),2)},YY:function(e){return ge(e.getFullYear(),4).substr(2)},YYYY:function(e){return ge(e.getFullYear(),4)},GG:function(e){return String(ue(e)).substr(2)},GGGG:function(e){return ue(e)},H:function(e){return e.getHours()},HH:function(e){return ge(e.getHours(),2)},h:function(e){var r=e.getHours();return 0===r?12:r>12?r%12:r},hh:function(e){return ge(ve.h(e),2)},m:function(e){return e.getMinutes()},mm:function(e){return ge(e.getMinutes(),2)},s:function(e){return e.getSeconds()},ss:function(e){return ge(e.getSeconds(),2)},S:function(e){return Math.floor(e.getMilliseconds()/100)},SS:function(e){return ge(Math.floor(e.getMilliseconds()/10),2)},SSS:function(e){return ge(e.getMilliseconds(),3)},Z:function(e){return me(e.getTimezoneOffset(),":")},ZZ:function(e){return me(e.getTimezoneOffset())},X:function(e){return Math.floor(e.getTime()/1e3)},x:function(e){return e.getTime()}};function me(e,r){r=r||"";var t=e>0?"-":"+",n=Math.abs(e),u=n%60;return t+ge(Math.floor(n/60),2)+r+ge(u,2)}function ge(e,r){for(var t=Math.abs(e).toString();t.length<r;)t="0"+t;return t}var he=function(e,r,t){var n=r?String(r):"YYYY-MM-DDTHH:mm:ss.SSSZ",u=(t||{}).locale,o=de.format.formatters,i=de.format.formattingTokensRegExp;u&&u.format&&u.format.formatters&&(o=u.format.formatters,u.format.formattingTokensRegExp&&(i=u.format.formattingTokensRegExp));var a=R(e);return fe(a)?function(e,r,t){var n,u,o,i=e.match(t),a=i.length;for(n=0;n<a;n++)u=r[i[n]]||ve[i[n]],i[n]=u||((o=i[n]).match(/\[[\s\S]/)?o.replace(/^\[|]$/g,""):o.replace(/\\/g,""));return function(e){for(var r="",t=0;t<a;t++)i[t]instanceof Function?r+=i[t](e,ve):r+=i[t];return r}}(n,o,i)(a):"Invalid Date"};var pe=function(e){var r=R(e),t=r.getFullYear(),n=r.getMonth(),u=new Date(0);return u.setFullYear(t,n+1,0),u.setHours(0,0,0,0),u.getDate()};var ye=function(e,r){var t=R(e),n=Number(r),u=t.getMonth()+n,o=new Date(0);o.setFullYear(t.getFullYear(),u,1),o.setHours(0,0,0,0);var i=pe(o);return t.setMonth(u,Math.min(i,t.getDate())),t};var xe=function(e,r){var t=R(e),n=Number(r);return t.setDate(t.getDate()+n),t};var De=function(e,r){var t=R(e).getTime(),n=Number(r);return new Date(t+n)},be=function(e,r,t){var n={years:function(e){return 12*e},quarters:function(e){return 3*e},months:function(e){return e}},u={weeks:function(e){return 7*e},days:function(e){return e}},o={hours:function(e){return 36e5*e},minutes:function(e){return 6e4*e},seconds:function(e){return 1e3*e},milliseconds:function(e){return e}};return e=Number(e),n[r]?ye(new Date,"-"===t?-n[r](e):n[r](e)):u[r]?xe(new Date,"-"===t?-u[r](e):u[r](e)):o[r]?De(new Date,"-"===t?-o[r](e):o[r](e)):void 0};e.above=function(e,t,n,o,a){var f=i(o,1)[0];return r(function(){if(!f)return new Error("above:make sure to define minValue");var r,o=a(e,t);return u(o)||(r=f,Number(o)>Number(r))?void 0:n})},e.accepted=function(e,t,o,i,a){return r(function(){var r,i=a(e,t);if(!(u(i)||n(r=i)&&!1!==r&&0!==r))return o})},e.alpha=function(e,t,n,o,i){return r(function(){var r,o=i(e,t);if(!u(o)&&(r=o,!a.test(r)))return n})},e.alphaNumeric=function(e,t,n,o,i){return r(function(){var r,o=i(e,t);if(!u(o)&&(r=o,!f.test(r)))return n})},e.array=function(e,t,n,o,i){return r(function(){var r=i(e,t);if(!u(r)&&!Array.isArray(r))return n})},e.boolean=function(e,t,n,o,i){return r(function(){var r=i(e,t);if(!u(r)&&!function(e){var r=[!0,!1,0,1];return arguments.length>1&&void 0!==arguments[1]&&!arguments[1]?r.map(function(e){return String(e)}).indexOf(String(e))>-1:r.indexOf(e)>-1}(r,!1))return n})},e.confirmed=function(e,t,n,o,i){return r(function(){var r,o,a=i(e,t);if(!u(a)&&(r=a,o=i(e,t+"_confirmation"),r!==o))return n})},e.different=function(e,t,n,o,a){var f=i(o,1)[0];return r(function(){if(!f)throw new Error("different:make sure to define target field for comparison");var r=a(e,t),o=a(e,f);if(!u(r)&&o&&o===r)return n})},e.email=function(e,t,n,o,i){return r(function(){var r,o=i(e,t);if(!u(o)&&!h(String(o),r))return n})},e.endsWith=function(e,t,n,o,a){var f=i(o,1)[0];return r(function(){if(!f)throw new Error("endsWith:make sure to define the matching substring");var r=a(e,t);if(!u(r)&&String(r).trim().substr(-f.length)!==String(f))return n})},e.equals=function(e,t,n,o,i){var a=o[0];return r(function(){var r=i(e,t);if(!u(r)&&a!=r)return n})},e.in=function(e,t,n,o,i){return r(function(){var r=i(e,t);if(!u(r)&&!p(r,o))return n})},e.includes=function(e,t,n,o,a){var f=i(o,1)[0];return r(function(){var r=a(e,t);if(!u(r)&&-1===String(r).indexOf(f))return n})},e.integer=function(e,t,n,o,i){return r(function(){var r=i(e,t);if(!u(r)&&!Number.isInteger(Number(r)))return n})},e.ip=function(e,t,n,o,i){return r(function(){var r,o=i(e,t);if(!u(o)&&!x(r=o)&&!b(r))return n})},e.ipv4=function(e,t,n,o,i){return r(function(){var r=i(e,t);if(!u(r)&&!x(r))return n})},e.ipv6=function(e,t,n,o,i){return r(function(){var r=i(e,t);if(!u(r)&&!b(r))return n})},e.json=function(e,t,n,o,i){return r(function(){var r=i(e,t);if(!u(r)&&!function(e){try{return JSON.parse(e),!0}catch(e){return !1}}(r))return n})},e.max=function(e,t,n,o,a){var f=i(o,1)[0];return r(function(){if(!f)throw new Error("max:make sure to define max length");var r=a(e,t),o=Array.isArray(r)?r:String(r);if(!u(r)&&o.length>f)return n})},e.min=function(e,t,n,o,a){var f=i(o,1)[0];return r(function(){if(!f)throw new Error("min:make sure to define min length");var r=a(e,t),o=Array.isArray(r)?r:String(r);if(!u(r)&&o.length<f)return n})},e.notEquals=function(e,t,n,o,a){var f=i(o,1)[0];return r(function(){var r=a(e,t);if(!u(r)&&f==r)return n})},e.notIn=function(e,t,n,o,i){return r(function(){var r=i(e,t);if(!u(r)&&p(r,o))return n})},e.number=function(e,t,n,o,i){return r(function(){var r=i(e,t),o="string"==typeof r?Number(r):r;if(!u(r)&&!function(e,r){var t="number"==typeof e&&!isNaN(e);return !0!==e&&!1!==e&&(t||r?t:!isNaN(e))}(o))return n})},e.object=function(e,t,n,o,i){return r(function(){var r,o=i(e,t);if(!u(o)&&(!((r=o)instanceof Object)||Array.isArray(r)))return n})},e.range=function(e,t,n,o,a){var f=i(o,2),c=f[0],s=f[1];return r(function(){if([c,s].some(function(e){return null===e||isNaN(e)}))return new Error("range:min and max values are required for range validation");var r=a(e,t);return u(r)||function(e,r,t){return (e=Number(e))>Number(r)&&e<Number(t)}(r,c,s)?void 0:n})},e.regex=function(e,t,n,o,a){var f=i(o,2),c=f[0],s=f[1];return r(function(){var r=a(e,t),o=c instanceof RegExp?c:new RegExp(c,s);if(!u(r)&&!o.test(r))return n})},e.required=function(e,t,n,u,o){return r(function(){if(F(o(e,t)))return n})},e.requiredIf=function(e,t,u,o,a){var f=i(o,1)[0];return r(function(){if(n(a(e,f))&&F(a(e,t)))return u})},e.requiredWhen=function(e,t,n,u,o){var a=i(u,2),f=a[0],c=a[1];return r(function(){var r=o(e,f);if(String(c)===String(r)&&F(o(e,t)))return n})},e.requiredWithAll=function(e,t,u,o,i){return r(function(){if(!o.some(function(r){return !n(i(e,r))})&&F(i(e,t)))return u})},e.requiredWithAny=function(e,t,u,o,i){return r(function(){if(o.some(function(r){return n(i(e,r))})&&F(i(e,t)))return u})},e.requiredWithoutAll=function(e,t,u,o,i){return r(function(){if(!o.some(function(r){return n(i(e,r))})&&F(i(e,t)))return u})},e.requiredWithoutAny=function(e,t,u,o,i){return r(function(){if(o.some(function(r){return !n(i(e,r))})&&F(i(e,t)))return u})},e.same=function(e,t,o,a,f){var c=i(a,1)[0];return r(function(){var r=f(e,t),i=f(e,c);if(!u(r)&&n(i)&&i!==r)return o})},e.startsWith=function(e,t,n,o,a){var f=i(o,1)[0];return r(function(){if(!f)throw new Error("startsWith:make sure to define the matching substring");var r=a(e,t);if(!u(r)&&String(r).trim().substr(0,f.length)!==String(f))return n})},e.string=function(e,t,n,o,i){return r(function(){var r=i(e,t);if(!u(r)&&"string"!=typeof r)return n})},e.under=function(e,t,n,o,a){var f=i(o,1)[0];return r(function(){if(!f)throw new Error("under:make sure to pass the max value");var r=a(e,t);if(!u(r)&&Number(r)>=Number(f))return n})},e.url=function(e,t,n,o,i){return r(function(){var r,o=i(e,t);if(!u(o)&&(r=o,!w.test(r)))return n})},e.after=function(e,t,n,o,a){var f=i(o,1)[0];return r(function(){if(!f)return new Error("after:make sure to define the after date");var r=a(e,t);return u(r)||J(r,f)?void 0:n})},e.before=function(e,t,n,o,a){var f=i(o,1)[0];return r(function(){if(!f)return new Error("before:make sure to define the before date");var r=a(e,t);return u(r)||Q(r,f)?void 0:n})},e.date=function(e,t,n,o,i){return r(function(){var r=i(e,t);if(!u(r)&&!function(e){var r=!(arguments.length>1&&void 0!==arguments[1])||arguments[1];return e instanceof Date==1||!r&&"Invalid Date"!==new Date(e).toString()}(r,!1))return n})},e.dateFormat=function(e,t,n,o,i){return r(function(){if(0===o.length)throw new Error("dateFormat:make sure to define atleast one date format");var r,a,f=i(e,t);if(!u(f)&&(r=f,a=o,!(Array.isArray(a)?a:[a]).some(function(e){var t=r,n=!1;e.endsWith("ZZ")?(t=r.replace(/(\+|-)\d{4}$/,""),e=e.replace(/ZZ$/,""),n=!0):e.endsWith("Z")&&(t=r.replace(/Z$/,"").replace(/(\+|-)\d{2}:\d{2}$/,""),e=e.replace(/Z$/,""),n=!0);var u=he(t,e);return "Invalid Date"!==u&&u===t&&(!n||t!==r)})))return n})},e.beforeOffsetOf=function(e,t,n,o,a){var f=i(o,2),c=f[0],s=f[1];return r(function(){if(!c||!s)return new Error("beforeOffsetOf:make sure to define offset unit and key");var r=a(e,t);return u(r)||function(e,r,t){var n=be(r,t,"-");return !!n&&Q(e,n)}(r,c,s)?void 0:n})},e.afterOffsetOf=function(e,t,n,o,a){var f=i(o,2),c=f[0],s=f[1];return r(function(){if(!c||!s)return new Error("afterOffsetOf:make sure to define offset unit and key");var r=a(e,t);return u(r)||function(e,r,t){var n=be(r,t,"+");return !!n&&J(e,n)}(r,c,s)?void 0:n})},Object.defineProperty(e,"__esModule",{value:!0});});
	});

	unwrapExports(validations);

	var require$$1 = getCjsExportFromNamespace(store);

	var require$$2 = getCjsExportFromNamespace(svelte);

	const {
	  Vanilla
	} = formatters;
	const {
	  writable: writable$1
	} = require$$1;
	const {
	  afterUpdate: afterUpdate$1,
	  tick: tick$1
	} = require$$2;
	//export * from 'indicative/builds/validations'
	const {
	  email,
	  required
	} = validations;

	var check = function validator$$1() {
	  const validatorInstance = validator({
	    email,
	    required
	  }, Vanilla);

	  return function (data) {
	    let schema = {};
	    let messages = {};
	    let errStore = writable$1();
	    let result = {};

	    Object.keys(data).forEach((prop) => {
	      result[prop] = {
	        isValid: true,
	        message: null
	      };

	    });

	    errStore.set(result);

	    let methods = {
	      schema: function (rules) {
	        schema = rules;
	        return this;
	      },
	      messages: function (msgTemplates) {
	        messages = msgTemplates;
	        return this;
	      },
	      test: function () {
	        let value = {};

	        afterUpdate$1(async () => {

	          if (!objCompare(data, value)) {

	            try {
	              await validatorInstance.validateAll(data, schema, messages);
	              Object.keys(data).forEach((prop) => {

	                result[prop] = {
	                  isValid: true,
	                  message: null
	                };
	              });

	              errStore.set(result);

	            } catch (errors) {

	              Object.keys(data).forEach((prop) => {
	                let error = errors.find((err) => err.field === prop);
	                if (error) {
	                  result[prop] = {
	                    isValid: false,
	                    message: error.message
	                  };
	                } else {
	                  result[prop] = {
	                    isValid: true,
	                    message: null
	                  };
	                }
	              });

	            }
	            console.log(result);
	            
	            errStore.set(result);

	          }
	          value = deepCopy(data);

	        });

	        return errStore

	      }
	    };

	    return methods

	  }

	};

	function objCompare(obj1, obj2) {
	  //Loop through properties in object 1
	  for (var p in obj1) {
	    //Check property exists on both objects
	    if (obj1.hasOwnProperty(p) !== obj2.hasOwnProperty(p)) return false;

	    switch (typeof (obj1[p])) {
	      //Deep compare objects
	      case 'object':
	        if (!Object.compare(obj1[p], obj2[p])) return false;
	        break;
	        //Compare function code
	      case 'function':
	        if (typeof (obj2[p]) == 'undefined' || (p != 'compare' && obj1[p].toString() != obj2[p].toString())) return false;
	        break;
	        //Compare values
	      default:
	        if (obj1[p] != obj2[p]) return false;
	    }
	  }

	  //Check object 2 for any extra properties
	  for (var p in obj2) {
	    if (typeof (obj1[p]) == 'undefined') return false;
	  }
	  return true;
	}
	function deepCopy(oldObj) {
	  var newObj = oldObj;
	  if (oldObj && typeof oldObj === 'object') {
	    newObj = Object.prototype.toString.call(oldObj) === "[object Array]" ? [] : {};
	    for (var i in oldObj) {
	      newObj[i] = deepCopy(oldObj[i]);
	    }
	  }
	  return newObj;
	}

	/* src/App.html generated by Svelte v3.0.0-beta.2 */

	const file = "src/App.html";

	// (24:1) {#if !$form1.email.isValid}
	function create_if_block_1(ctx) {
		var div, text_value = ctx.$form1.email.message, text;

		return {
			c: function create() {
				div = createElement("div");
				text = createText(text_value);
				div.className = "error svelte-12zgbi7";
				addLoc(div, file, 24, 0, 535);
			},

			m: function mount(target, anchor) {
				insert(target, div, anchor);
				append(div, text);
			},

			p: function update(changed, ctx) {
				if ((changed.$form1) && text_value !== (text_value = ctx.$form1.email.message)) {
					setData(text, text_value);
				}
			},

			d: function destroy(detach) {
				if (detach) {
					detachNode(div);
				}
			}
		};
	}

	// (30:1) {#if !$form1.age.isValid}
	function create_if_block(ctx) {
		var div, text_value = ctx.$form1.age.message, text;

		return {
			c: function create() {
				div = createElement("div");
				text = createText(text_value);
				div.className = "error svelte-12zgbi7";
				addLoc(div, file, 30, 0, 680);
			},

			m: function mount(target, anchor) {
				insert(target, div, anchor);
				append(div, text);
			},

			p: function update(changed, ctx) {
				if ((changed.$form1) && text_value !== (text_value = ctx.$form1.age.message)) {
					setData(text, text_value);
				}
			},

			d: function destroy(detach) {
				if (detach) {
					detachNode(div);
				}
			}
		};
	}

	function create_fragment(ctx) {
		var input0, text0, text1, input1, text2, if_block1_anchor, dispose;

		var if_block0 = (!ctx.$form1.email.isValid) && create_if_block_1(ctx);

		var if_block1 = (!ctx.$form1.age.isValid) && create_if_block(ctx);

		return {
			c: function create() {
				input0 = createElement("input");
				text0 = createText("\n\n\t");
				if (if_block0) if_block0.c();
				text1 = createText("\n\n");
				input1 = createElement("input");
				text2 = createText("\n\t\n\t");
				if (if_block1) if_block1.c();
				if_block1_anchor = createComment();
				input0.placeholder = "Enter your email";
				addLoc(input0, file, 21, 0, 442);
				input1.placeholder = "Enter your age";
				addLoc(input1, file, 27, 0, 591);

				dispose = [
					addListener(input0, "input", ctx.input0_input_handler),
					addListener(input1, "input", ctx.input1_input_handler)
				];
			},

			l: function claim(nodes) {
				throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
			},

			m: function mount(target, anchor) {
				insert(target, input0, anchor);

				input0.value = ctx.user.email;

				insert(target, text0, anchor);
				if (if_block0) if_block0.m(target, anchor);
				insert(target, text1, anchor);
				insert(target, input1, anchor);

				input1.value = ctx.user.age;

				insert(target, text2, anchor);
				if (if_block1) if_block1.m(target, anchor);
				insert(target, if_block1_anchor, anchor);
			},

			p: function update(changed, ctx) {
				if (changed.user) input0.value = ctx.user.email;

				if (!ctx.$form1.email.isValid) {
					if (if_block0) {
						if_block0.p(changed, ctx);
					} else {
						if_block0 = create_if_block_1(ctx);
						if_block0.c();
						if_block0.m(text1.parentNode, text1);
					}
				} else if (if_block0) {
					if_block0.d(1);
					if_block0 = null;
				}

				if (changed.user) input1.value = ctx.user.age;

				if (!ctx.$form1.age.isValid) {
					if (if_block1) {
						if_block1.p(changed, ctx);
					} else {
						if_block1 = create_if_block(ctx);
						if_block1.c();
						if_block1.m(if_block1_anchor.parentNode, if_block1_anchor);
					}
				} else if (if_block1) {
					if_block1.d(1);
					if_block1 = null;
				}
			},

			i: noop,
			o: noop,

			d: function destroy(detach) {
				if (detach) {
					detachNode(input0);
					detachNode(text0);
				}

				if (if_block0) if_block0.d(detach);

				if (detach) {
					detachNode(text1);
					detachNode(input1);
					detachNode(text2);
				}

				if (if_block1) if_block1.d(detach);

				if (detach) {
					detachNode(if_block1_anchor);
				}

				run_all(dispose);
			}
		};
	}

	function instance($$self, $$props, $$invalidate) {
		//import {email, required} from './check'
		const validate = check();
		let user = { email: "Zafar Ansari", age: 47 };
		
		//	const form1 = validate(user, { email: "required|email", age: "required" });
		const form1 = validate(user)
		  .schema({ email: "required|email", age: "required" })
		  //.messages({})
			.test();

		function input0_input_handler() {
			user.email = this.value;
			$$invalidate('user', user);
		}

		function input1_input_handler() {
			user.age = this.value;
			$$invalidate('user', user);
		}

		let $form1;
		validate_store(form1, 'form1');
		$$self.$$.on_destroy.push(form1.subscribe($$value => { $form1 = $$value; $$invalidate('$form1', $form1); }));

		$$self.$$.update = ($$dirty = { console: 1, $form1: 1 }) => {
			if ($$dirty.console || $$dirty.$form1) {
				console.log($form1);
				console.log($form1.email);
				
				}
		};

		return {
			user,
			form1,
			$form1,
			input0_input_handler,
			input1_input_handler
		};
	}

	class App extends SvelteComponentDev {
		constructor(options) {
			super(options);
			init(this, options, instance, create_fragment, safe_not_equal);
		}
	}

	const app = new App({
		target: document.body,
		props: {
		//	name: 'world'
		}
	});

	return app;

}());
//# sourceMappingURL=bundle.js.map
