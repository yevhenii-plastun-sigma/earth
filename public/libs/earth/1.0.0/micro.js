/**
 * micro - a grab bag of somewhat useful utility functions and other stuff that requires unit testing
 *
 * Copyright (c) 2014 Cameron Beccario
 * The MIT License - http://opensource.org/licenses/MIT
 *
 * https://github.com/cambecc/earth
 */
const micro = (function () {
  "use strict";
  let wrapError = function(model, options) {
    let error = options.error;
    options.error = function(resp) {
      if (error) error(model, resp, options);
      model.trigger('error', model, resp, options);
    };
  };
  let eventSplitter = /\s+/;
  let triggerEvents = function(events, args) {
    let ev, i = -1, l = events.length, a1 = args[0], a2 = args[1], a3 = args[2];
    switch (args.length) {
      case 0: while (++i < l) (ev = events[i]).callback.call(ev.ctx); return;
      case 1: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1); return;
      case 2: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2); return;
      case 3: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2, a3); return;
      default: while (++i < l) (ev = events[i]).callback.apply(ev.ctx, args);
    }
  };

  // Implement fancy features of the Events API such as multiple event
  // names `"change blur"` and jQuery-style event maps `{change: action}`
  // in terms of the existing API.
  let eventsApi = function(obj, action, name, rest) {
    if (!name) return true;

    // Handle event maps.
    if (typeof name === 'object') {
      for (let key in name) {
        obj[action].apply(obj, [key, name[key]].concat(rest));
      }
      return false;
    }

    // Handle space separated event names.
    if (eventSplitter.test(name)) {
      let names = name.split(eventSplitter);
      for (let i = 0, l = names.length; i < l; i++) {
        obj[action].apply(obj, [names[i]].concat(rest));
      }
      return false;
    }

    return true;
  };

  let Events = {

    // Bind an event to a `callback` function. Passing `"all"` will bind
    // the callback to all events fired.
    on: function(name, callback, context) {
      if (!eventsApi(this, 'on', name, [callback, context]) || !callback) return this;
      this._events || (this._events = {});
      let events = this._events[name] || (this._events[name] = []);
      events.push({callback: callback, context: context, ctx: context || this});
      return this;
    },

    // Bind an event to only be triggered a single time. After the first time
    // the callback is invoked, it will be removed.
    once: function(name, callback, context) {
      if (!eventsApi(this, 'once', name, [callback, context]) || !callback) return this;
      let self = this;
      let once = _.once(function() {
        self.off(name, once);
        callback.apply(this, arguments);
      });
      once._callback = callback;
      return this.on(name, once, context);
    },

    // Remove one or many callbacks. If `context` is null, removes all
    // callbacks with that function. If `callback` is null, removes all
    // callbacks for the event. If `name` is null, removes all bound
    // callbacks for all events.
    off: function(name, callback, context) {
      let retain, ev, events, names, i, l, j, k;
      if (!this._events || !eventsApi(this, 'off', name, [callback, context])) return this;
      if (!name && !callback && !context) {
        this._events = {};
        return this;
      }
      names = name ? [name] : _.keys(this._events);
      for (i = 0, l = names.length; i < l; i++) {
        name = names[i];
        if (events = this._events[name]) {
          this._events[name] = retain = [];
          if (callback || context) {
            for (j = 0, k = events.length; j < k; j++) {
              ev = events[j];
              if ((callback && callback !== ev.callback && callback !== ev.callback._callback) ||
                  (context && context !== ev.context)) {
                retain.push(ev);
              }
            }
          }
          if (!retain.length) delete this._events[name];
        }
      }

      return this;
    },

    // Trigger one or many events, firing all bound callbacks. Callbacks are
    // passed the same arguments as `trigger` is, apart from the event name
    // (unless you're listening on `"all"`, which will cause your callback to
    // receive the true name of the event as the first argument).
    trigger: function(name) {
      if (!this._events) return this;
      let args = [...arguments].slice(1);
      if (!eventsApi(this, 'trigger', name, args)) return this;
      let events = this._events[name];
      let allEvents = this._events.all;
      if (events) triggerEvents(events, args);
      if (allEvents) triggerEvents(allEvents, arguments);
      return this;
    },

    // Tell this object to stop listening to either specific events ... or
    // to every object it's currently listening to.
    stopListening: function(obj, name, callback) {
      let listeningTo = this._listeningTo;
      if (!listeningTo) return this;
      let remove = !name && !callback;
      if (!callback && typeof name === 'object') callback = this;
      if (obj) (listeningTo = {})[obj._listenId] = obj;
      for (let id in listeningTo) {
        obj = listeningTo[id];
        obj.off(name, callback, this);
        if (remove || _.isEmpty(obj._events)) delete this._listeningTo[id];
      }
      return this;
    },

    listenTo: function(obj, name, callback) {
      let listeningTo = this._listeningTo || (this._listeningTo = {});
      let id = obj._listenId || (obj._listenId = _.uniqueId('l'));
      listeningTo[id] = obj;
      if (!callback && typeof name === 'object') callback = this;
      obj.on(name, callback, this);
      return this;
    },
    listenToOnce: function(obj, name, callback) {
      let listeningTo = this._listeningTo || (this._listeningTo = {});
      let id = obj._listenId || (obj._listenId = _.uniqueId('l'));
      listeningTo[id] = obj;
      if (!callback && typeof name === 'object') callback = this;
      obj.once(name, callback, this);
      return this;
    }
  };

  let Model  = function(attributes, options) {
    let attrs = attributes || {};
    options || (options = {});
    this.cid = _.uniqueId('c');
    this.attributes = {};
    if (options.collection) this.collection = options.collection;
    if (options.parse) attrs = this.parse(attrs, options) || {};
    attrs = _.defaults({}, attrs, _.result(this, 'defaults'));
    this.set(attrs, options);
    this.changed = {};
    this.initialize.apply(this, arguments);
  };

  // Attach all inheritable methods to the Model prototype.
  _.extend(Model.prototype, Events, {

    // A hash of attributes whose current and previous value differ.
    changed: null,

    // The value returned during the last failed validation.
    validationError: null,

    // The default name for the JSON `id` attribute is `"id"`. MongoDB and
    // CouchDB users may want to set this to `"_id"`.
    idAttribute: 'id',

    // Initialize is an empty function by default. Override it with your own
    // initialization logic.
    initialize: function(){},

    // Return a copy of the model's `attributes` object.
    toJSON: function(options) {
      return _.clone(this.attributes);
    },

    // Proxy `Backbone.sync` by default -- but override this if you need
    // custom syncing semantics for *this* particular model.
    sync: function() {
      return this.sync( ...arguments);
    },

    // Get the value of an attribute.
    get: function(attr) {
      return this.attributes[attr];
    },

    // Get the HTML-escaped value of an attribute.
    escape: function(attr) {
      return _.escape(this.get(attr));
    },

    // Returns `true` if the attribute contains a value that is not null
    // or undefined.
    has: function(attr) {
      return this.get(attr) != null;
    },

    // Set a hash of model attributes on the object, firing `"change"`. This is
    // the core primitive operation of a model, updating the data and notifying
    // anyone who needs to know about the change in state. The heart of the beast.
    set: function(key, val, options) {
      let attr, attrs, unset, changes, silent, changing, prev, current;
      if (key == null) return this;

      // Handle both `"key", value` and `{key: value}` -style arguments.
      if (typeof key === 'object') {
        attrs = key;
        options = val;
      } else {
        (attrs = {})[key] = val;
      }

      options || (options = {});

      // Run validation.
      if (!this._validate(attrs, options)) return false;

      // Extract attributes and options.
      unset           = options.unset;
      silent          = options.silent;
      changes         = [];
      changing        = this._changing;
      this._changing  = true;

      if (!changing) {
        this._previousAttributes = _.clone(this.attributes);
        this.changed = {};
      }
      current = this.attributes, prev = this._previousAttributes;

      // Check for changes of `id`.
      if (this.idAttribute in attrs) this.id = attrs[this.idAttribute];

      // For each `set` attribute, update or delete the current value.
      for (attr in attrs) {
        val = attrs[attr];
        if (!_.isEqual(current[attr], val)) changes.push(attr);
        if (!_.isEqual(prev[attr], val)) {
          this.changed[attr] = val;
        } else {
          delete this.changed[attr];
        }
        unset ? delete current[attr] : current[attr] = val;
      }

      // Trigger all relevant attribute changes.
      if (!silent) {
        if (changes.length) this._pending = true;
        for (let i = 0, l = changes.length; i < l; i++) {
          this.trigger('change:' + changes[i], this, current[changes[i]], options);
        }
      }

      // You might be wondering why there's a `while` loop here. Changes can
      // be recursively nested within `"change"` events.
      if (changing) return this;
      if (!silent) {
        while (this._pending) {
          this._pending = false;
          this.trigger('change', this, options);
        }
      }
      this._pending = false;
      this._changing = false;
      return this;
    },

    // Remove an attribute from the model, firing `"change"`. `unset` is a noop
    // if the attribute doesn't exist.
    unset: function(attr, options) {
      return this.set(attr, void 0, _.extend({}, options, {unset: true}));
    },

    // Clear all attributes on the model, firing `"change"`.
    clear: function(options) {
      let attrs = {};
      for (let key in this.attributes) attrs[key] = void 0;
      return this.set(attrs, _.extend({}, options, {unset: true}));
    },

    // Determine if the model has changed since the last `"change"` event.
    // If you specify an attribute name, determine if that attribute has changed.
    hasChanged: function(attr) {
      if (attr == null) return !_.isEmpty(this.changed);
      return _.has(this.changed, attr);
    },

    // Return an object containing all the attributes that have changed, or
    // false if there are no changed attributes. Useful for determining what
    // parts of a view need to be updated and/or what attributes need to be
    // persisted to the server. Unset attributes will be set to undefined.
    // You can also pass an attributes object to diff against the model,
    // determining if there *would be* a change.
    changedAttributes: function(diff) {
      if (!diff) return this.hasChanged() ? _.clone(this.changed) : false;
      let val, changed = false;
      let old = this._changing ? this._previousAttributes : this.attributes;
      for (let attr in diff) {
        if (_.isEqual(old[attr], (val = diff[attr]))) continue;
        (changed || (changed = {}))[attr] = val;
      }
      return changed;
    },

    // Get the previous value of an attribute, recorded at the time the last
    // `"change"` event was fired.
    previous: function(attr) {
      if (attr == null || !this._previousAttributes) return null;
      return this._previousAttributes[attr];
    },

    // Get all of the attributes of the model at the time of the previous
    // `"change"` event.
    previousAttributes: function() {
      return _.clone(this._previousAttributes);
    },

    // Fetch the model from the server. If the server's representation of the
    // model differs from its current attributes, they will be overridden,
    // triggering a `"change"` event.
    fetch: function(options) {
      options = options ? _.clone(options) : {};
      if (options.parse === void 0) options.parse = true;
      let model = this;
      let success = options.success;
      options.success = function(resp) {
        if (!model.set(model.parse(resp, options), options)) return false;
        if (success) success(model, resp, options);
        model.trigger('sync', model, resp, options);
      };
      wrapError(this, options);
      return this.sync('read', this, options);
    },

    // Set a hash of model attributes, and sync the model to the server.
    // If the server returns an attributes hash that differs, the model's
    // state will be `set` again.
    save: function(key, val, options) {
      let attrs, method, xhr, attributes = this.attributes;

      // Handle both `"key", value` and `{key: value}` -style arguments.
      if (key == null || typeof key === 'object') {
        attrs = key;
        options = val;
      } else {
        (attrs = {})[key] = val;
      }

      options = _.extend({validate: true}, options);

      // If we're not waiting and attributes exist, save acts as
      // `set(attr).save(null, opts)` with validation. Otherwise, check if
      // the model will be valid when the attributes, if any, are set.
      if (attrs && !options.wait) {
        if (!this.set(attrs, options)) return false;
      } else {
        if (!this._validate(attrs, options)) return false;
      }

      // Set temporary attributes if `{wait: true}`.
      if (attrs && options.wait) {
        this.attributes = _.extend({}, attributes, attrs);
      }

      // After a successful server-side save, the client is (optionally)
      // updated with the server-side state.
      if (options.parse === void 0) options.parse = true;
      let model = this;
      let success = options.success;
      options.success = function(resp) {
        // Ensure attributes are restored during synchronous saves.
        model.attributes = attributes;
        let serverAttrs = model.parse(resp, options);
        if (options.wait) serverAttrs = _.extend(attrs || {}, serverAttrs);
        if (_.isObject(serverAttrs) && !model.set(serverAttrs, options)) {
          return false;
        }
        if (success) success(model, resp, options);
        model.trigger('sync', model, resp, options);
      };
      wrapError(this, options);

      method = this.isNew() ? 'create' : (options.patch ? 'patch' : 'update');
      if (method === 'patch') options.attrs = attrs;
      xhr = this.sync(method, this, options);

      // Restore attributes.
      if (attrs && options.wait) this.attributes = attributes;

      return xhr;
    },

    // Destroy this model on the server if it was already persisted.
    // Optimistically removes the model from its collection, if it has one.
    // If `wait: true` is passed, waits for the server to respond before removal.
    destroy: function(options) {
      options = options ? _.clone(options) : {};
      let model = this;
      let success = options.success;

      let destroy = function() {
        model.trigger('destroy', model, model.collection, options);
      };

      options.success = function(resp) {
        if (options.wait || model.isNew()) destroy();
        if (success) success(model, resp, options);
        if (!model.isNew()) model.trigger('sync', model, resp, options);
      };

      if (this.isNew()) {
        options.success();
        return false;
      }
      wrapError(this, options);

      let xhr = this.sync('delete', this, options);
      if (!options.wait) destroy();
      return xhr;
    },

    // Default URL for the model's representation on the server -- if you're
    // using Backbone's restful methods, override this to change the endpoint
    // that will be called.
    url: function() {
      let base = _.result(this, 'urlRoot') || _.result(this.collection, 'url') || urlError();
      if (this.isNew()) return base;
      return base + (base.charAt(base.length - 1) === '/' ? '' : '/') + encodeURIComponent(this.id);
    },

    // **parse** converts a response into the hash of attributes to be `set` on
    // the model. The default implementation is just to pass the response along.
    parse: function(resp, options) {
      return resp;
    },

    // Create a new model with identical attributes to this one.
    clone: function() {
      return new this.constructor(this.attributes);
    },

    // A model is new if it has never been saved to the server, and lacks an id.
    isNew: function() {
      return this.id == null;
    },

    // Check if the model is currently in a valid state.
    isValid: function(options) {
      return this._validate({}, _.extend(options || {}, { validate: true }));
    },

    // Run validation against the next complete set of model attributes,
    // returning `true` if all is well. Otherwise, fire an `"invalid"` event.
    _validate: function(attrs, options) {
      if (!options.validate || !this.validate) return true;
      attrs = _.extend({}, this.attributes, attrs);
      let error = this.validationError = this.validate(attrs, options) || null;
      if (!error) return true;
      this.trigger('invalid', this, error, _.extend(options, {validationError: error}));
      return false;
    }

  });

  // Underscore methods that we want to implement on the Model.
  let modelMethods = ['keys', 'values', 'pairs', 'invert', 'pick', 'omit'];

  // Mix in each Underscore method as a proxy to `Model#attributes`.
  _.each(modelMethods, function(method) {
    Model.prototype[method] = function() {
      let args = [...arguments];
      args.unshift(this.attributes);
      return _[method].apply(_, args);
    };
  });

  let τ = 2 * Math.PI;
  let H = 0.000036; // 0.0000360°φ ~= 4m
  let DEFAULT_CONFIG = "current/wind/surface/level/orthographic";
  let TOPOLOGY = isMobile()
    ? "/data/earth-topo-mobile.json?v2"
    : "/data/earth-topo.json?v2";

  /**
   * @returns {Boolean} true if the specified value is truthy.
   */
  function isTruthy(x) {
    return !!x;
  }

  /**
   * @returns {Boolean} true if the specified value is not null and not undefined.
   */
  function isValue(x) {
    return x !== null && x !== undefined;
  }

  /**
   * @returns {Object} the first argument if not null and not undefined, otherwise the second argument.
   */
  function coalesce(a, b) {
    return isValue(a) ? a : b;
  }

  /**
   * @returns {Number} returns remainder of floored division, i.e., floor(a / n). Useful for consistent modulo
   *          of negative numbers. See http://en.wikipedia.org/wiki/Modulo_operation.
   */
  function floorMod(a, n) {
    let f = a - n * Math.floor(a / n);
    // HACK: when a is extremely close to an n transition, f can be equal to n. This is bad because f must be
    //       within range [0, n). Check for this corner case. Example: a:=-1e-16, n:=10. What is the proper fix?
    return f === n ? 0 : f;
  }

  /**
   * @returns {Number} distance between two points having the form [x, y].
   */
  function distance(a, b) {
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * @returns {Number} the value x clamped to the range [low, high].
   */
  function clamp(x, low, high) {
    return Math.max(low, Math.min(x, high));
  }

  /**
   * @returns {number} the fraction of the bounds [low, high] covered by the value x, after clamping x to the
   *          bounds. For example, given bounds=[10, 20], this method returns 1 for x>=20, 0.5 for x=15 and 0
   *          for x<=10.
   */
  function proportion(x, low, high) {
    return (micro.clamp(x, low, high) - low) / (high - low);
  }

  /**
   * @returns {number} the value p within the range [0, 1], scaled to the range [low, high].
   */
  function spread(p, low, high) {
    return p * (high - low) + low;
  }

  /**
   * Pad number with leading zeros. Does not support fractional or negative numbers.
   */
  function zeroPad(n, width) {
    let s = n.toString();
    let i = Math.max(width - s.length, 0);
    return new Array(i + 1).join("0") + s;
  }

  /**
   * @returns {String} the specified string with the first letter capitalized.
   */
  function capitalize(s) {
    return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.substr(1);
  }

  /**
   * @returns {Boolean} true if agent is probably firefox. Don't really care if this is accurate.
   */
  function isFF() {
    return /firefox/i.test(navigator.userAgent);
  }

  /**
   * @returns {Boolean} true if agent is probably a mobile device. Don't really care if this is accurate.
   */
  function isMobile() {
    return /android|blackberry|iemobile|ipad|iphone|ipod|opera mini|webos/i.test(
      navigator.userAgent
    );
  }

  function isEmbeddedInIFrame() {
    return window != window.top;
  }

  function toUTCISO(date) {
    return (
      date.getUTCFullYear() +
      "-" +
      zeroPad(date.getUTCMonth() + 1, 2) +
      "-" +
      zeroPad(date.getUTCDate(), 2) +
      " " +
      zeroPad(date.getUTCHours(), 2) +
      ":00"
    );
  }

  function toLocalISO(date) {
    return (
      date.getFullYear() +
      "-" +
      zeroPad(date.getMonth() + 1, 2) +
      "-" +
      zeroPad(date.getDate(), 2) +
      " " +
      zeroPad(date.getHours(), 2) +
      ":00"
    );
  }

  /**
   * @returns {String} the string yyyyfmmfdd as yyyytmmtdd, where f and t are the "from" and "to" delimiters. Either
   *          delimiter may be the empty string.
   */
  function ymdRedelimit(ymd, fromDelimiter, toDelimiter) {
    if (!fromDelimiter) {
      return (
        ymd.substr(0, 4) +
        toDelimiter +
        ymd.substr(4, 2) +
        toDelimiter +
        ymd.substr(6, 2)
      );
    }
    let parts = ymd.substr(0, 10).split(fromDelimiter);
    return [parts[0], parts[1], parts[2]].join(toDelimiter);
  }

  /**
   * @returns {String} the UTC year, month, and day of the specified date in yyyyfmmfdd format, where f is the
   *          delimiter (and may be the empty string).
   */
  function dateToUTCymd(date, delimiter) {
    return ymdRedelimit(date.toISOString(), "-", delimiter || "");
  }

  function dateToConfig(date) {
    return {
      date: micro.dateToUTCymd(date, "/"),
      hour: micro.zeroPad(date.getUTCHours(), 2) + "00",
    };
  }

  /**
   * @returns {Object} an object to perform logging, if/when the browser supports it.
   */
  function log() {
    function format(o) {
      return o && o.stack ? o + "\n" + o.stack : o;
    }
    return {
      debug: function (s) {
        if (console && console.log) console.log(format(s));
      },
      info: function (s) {
        if (console && console.info) console.info(format(s));
      },
      error: function (e) {
        if (console && console.error) console.error(format(e));
      },
      time: function (s) {
        if (console && console.time) console.time(format(s));
      },
      timeEnd: function (s) {
        if (console && console.timeEnd) console.timeEnd(format(s));
      },
    };
  }

  /**
   * @returns {width: (Number), height: (Number)} an object that describes the size of the browser's current view.
   */
  function view() {
    let w = window;
    let d = document && document.documentElement;
    let b = document && document.getElementsByTagName("body")[0];
    let x = w.innerWidth || d.clientWidth || b.clientWidth;
    let y = w.innerHeight || d.clientHeight || b.clientHeight;
    return { width: x, height: y };
  }

  /**
   * Removes all children of the specified DOM element.
   */
  function removeChildren(element) {
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  /**
   * @returns {Object} clears and returns the specified Canvas element's 2d context.
   */
  function clearCanvas(canvas) {
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function colorInterpolator(start, end) {
    let r = start[0],
      g = start[1],
      b = start[2];
    let Δr = end[0] - r,
      Δg = end[1] - g,
      Δb = end[2] - b;
    return function (i, a) {
      return [
        Math.floor(r + i * Δr),
        Math.floor(g + i * Δg),
        Math.floor(b + i * Δb),
        a,
      ];
    };
  }

  /**
   * Produces a color style in a rainbow-like trefoil color space. Not quite HSV, but produces a nice
   * spectrum. See http://krazydad.com/tutorials/makecolors.php.
   *
   * @param hue the hue rotation in the range [0, 1]
   * @param a the alpha value in the range [0, 255]
   * @returns {Array} [r, g, b, a]
   */
  function sinebowColor(hue, a) {
    // Map hue [0, 1] to radians [0, 5/6τ]. Don't allow a full rotation because that keeps hue == 0 and
    // hue == 1 from mapping to the same color.
    let rad = (hue * τ * 5) / 6;
    rad *= 0.75; // increase frequency to 2/3 cycle per rad

    let s = Math.sin(rad);
    let c = Math.cos(rad);
    let r = Math.floor(Math.max(0, -c) * 255);
    let g = Math.floor(Math.max(s, 0) * 255);
    let b = Math.floor(Math.max(c, 0, -s) * 255);
    return [r, g, b, a];
  }

  let BOUNDARY = 0.45;
  let fadeToWhite = colorInterpolator(sinebowColor(1.0, 0), [255, 255, 255]);

  /**
   * Interpolates a sinebow color where 0 <= i <= j, then fades to white where j < i <= 1.
   *
   * @param i number in the range [0, 1]
   * @param a alpha value in range [0, 255]
   * @returns {Array} [r, g, b, a]
   */
  function extendedSinebowColor(i, a) {
    return i <= BOUNDARY
      ? sinebowColor(i / BOUNDARY, a)
      : fadeToWhite((i - BOUNDARY) / (1 - BOUNDARY), a);
  }

  function asColorStyle(r, g, b, a) {
    return "rgba(" + r + ", " + g + ", " + b + ", " + a + ")";
  }

  /**
   * @returns {Array} of wind colors and a method, indexFor, that maps wind magnitude to an index on the color scale.
   */
  function windIntensityColorScale(step, maxWind) {
    let result = [];
    for (let j = 85; j <= 255; j += step) {
      result.push(asColorStyle(j, j, j, 1.0));
    }
    result.indexFor = function (m) {
      // map wind speed to a style
      return Math.floor((Math.min(m, maxWind) / maxWind) * (result.length - 1));
    };
    return result;
  }

  /**
   * Creates a color scale composed of the specified segments. Segments is an array of two-element arrays of the
   * form [value, color], where value is the point along the scale and color is the [r, g, b] color at that point.
   * For example, the following creates a scale that smoothly transitions from red to green to blue along the
   * points 0.5, 1.0, and 3.5:
   *
   *     [ [ 0.5, [255, 0, 0] ],
   *       [ 1.0, [0, 255, 0] ],
   *       [ 3.5, [0, 0, 255] ] ]
   *
   * @param segments array of color segments
   * @returns {Function} a function(point, alpha) that returns the color [r, g, b, alpha] for the given point.
   */
  function segmentedColorScale(segments) {
    let points = [],
      interpolators = [],
      ranges = [];
    for (let i = 0; i < segments.length - 1; i++) {
      points.push(segments[i + 1][0]);
      interpolators.push(colorInterpolator(segments[i][1], segments[i + 1][1]));
      ranges.push([segments[i][0], segments[i + 1][0]]);
    }

    return function (point, alpha) {
      let i;
      for (i = 0; i < points.length - 1; i++) {
        if (point <= points[i]) {
          break;
        }
      }
      let range = ranges[i];
      return interpolators[i](
        micro.proportion(point, range[0], range[1]),
        alpha
      );
    };
  }

  /**
   * Returns a human readable string for the provided coordinates.
   */
  function formatCoordinates(λ, φ) {
    return (
      Math.abs(φ).toFixed(2) +
      "° " +
      (φ >= 0 ? "N" : "S") +
      ", " +
      Math.abs(λ).toFixed(2) +
      "° " +
      (λ >= 0 ? "E" : "W")
    );
  }

  /**
   * Returns a human readable string for the provided scalar in the given units.
   */
  function formatScalar(value, units) {
    return units.conversion(value).toFixed(units.precision);
  }

  /**
   * Returns a human readable string for the provided rectangular wind vector in the given units.
   * See http://mst.nerc.ac.uk/wind_vect_convs.html.
   */
  function formatVector(wind, units) {
    let d = (Math.atan2(-wind[0], -wind[1]) / τ) * 360; // calculate into-the-wind cardinal degrees
    let wd = Math.round(((d + 360) % 360) / 5) * 5; // shift [-180, 180] to [0, 360], and round to nearest 5.
    return wd.toFixed(0) + "° @ " + formatScalar(wind[2], units);
  }

  /**
   * Returns a promise for a JSON resource (URL) fetched via XHR. If the load fails, the promise rejects with an
   * object describing the reason: {status: http-status-code, message: http-status-text, resource:}.
   */
  function loadJson(resource) {
    return new Promise((resolve, reject) => {
      d3.json(resource, function (error, result) {
        return error
          ? !error.status
            ? reject({
                status: -1,
                message: "Cannot load resource: " + resource,
                resource: resource,
              })
            : reject({
                status: error.status,
                message: error.statusText,
                resource: resource,
              })
          : resolve(result);
      });
    });
  }

  /**
   * Returns the distortion introduced by the specified projection at the given point.
   *
   * This method uses finite difference estimates to calculate warping by adding a very small amount (h) to
   * both the longitude and latitude to create two lines. These lines are then projected to pixel space, where
   * they become diagonals of triangles that represent how much the projection warps longitude and latitude at
   * that location.
   *
   * <pre>
   *        (λ, φ+h)                  (xλ, yλ)
   *           .                         .
   *           |               ==>        \
   *           |                           \   __. (xφ, yφ)
   *    (λ, φ) .____. (λ+h, φ)       (x, y) .--
   * </pre>
   *
   * See:
   *     Map Projections: A Working Manual, Snyder, John P: pubs.er.usgs.gov/publication/pp1395
   *     gis.stackexchange.com/questions/5068/how-to-create-an-accurate-tissot-indicatrix
   *     www.jasondavies.com/maps/tissot
   *
   * @returns {Array} array of scaled derivatives [dx/dλ, dy/dλ, dx/dφ, dy/dφ]
   */
  function distortion(projection, lambda, fi, x, y) {
    let hLambda = lambda < 0 ? H : -H;
    let hFi = fi < 0 ? H : -H;
    let pLambda = projection([lambda + hLambda, fi]);
    let pFi = projection([lambda, fi + hFi]);

    // Meridian scale factor (see Snyder, equation 4-3), where R = 1. This handles issue where length of 1° λ
    // changes depending on φ. Without this, there is a pinching effect at the poles.
    let k = Math.cos((fi / 360) * τ);

    return [
      (pLambda[0] - x) / hLambda / k,
      (pLambda[1] - y) / hLambda / k,
      (pFi[0] - x) / hFi,
      (pFi[1] - y) / hFi,
    ];
  }

  /**
   * Returns a new agent. An agent executes tasks and stores the result of the most recently completed task.
   *
   * A task is a value or promise, or a function that returns a value or promise. After submitting a task to
   * an agent using the submit() method, the task is evaluated and its result becomes the agent's value,
   * replacing the previous value. If a task is submitted to an agent while an earlier task is still in
   * progress, the earlier task is cancelled and its result ignored. Evaluation of a task may even be skipped
   * entirely if cancellation occurs early enough.
   *
   * Agents are Backbone.js Event emitters. When a submitted task is accepted for invocation by an agent, a
   * "submit" event is emitted. This event has the agent as its sole argument. When a task finishes and
   * the agent's value changes, an "update" event is emitted, providing (value, agent) as arguments. If a task
   * fails by either throwing an exception or rejecting a promise, a "reject" event having arguments (err, agent)
   * is emitted. If an event handler throws an error, an "error" event having arguments (err, agent) is emitted.
   *
   * The current task can be cancelled by invoking the agent.cancel() method, and the cancel status is available
   * as the Boolean agent.cancel.requested key. Within the task callback, the "this" context is set to the agent,
   * so a task can know to abort execution by checking the this.cancel.requested key. Similarly, a task can cancel
   * itself by invoking this.cancel().
   *
   * Example pseudocode:
   * <pre>
   *     let agent = newAgent();
   *     agent.on("update", function(value) {
   *         console.log("task completed: " + value);  // same as agent.value()
   *     });
   *
   *     function someLongAsynchronousProcess(x) {  // x === "abc"
   *         let d = when.defer();
   *         // some long process that eventually calls: d.resolve(result)
   *         return d.promise;
   *     }
   *
   *     agent.submit(someLongAsynchronousProcess, "abc");
   * </pre>
   *
   * @param [initial] initial value of the agent, if any
   * @returns {Object}
   */
  function newAgent() {
    /**
     * Invokes the specified task.
     * @param cancel the task's cancel function.
     * @param taskAndArguments the [task-function-or-value, arg0, arg1, ...] array.
     */
    function runTask(cancel, taskAndArguments) {
      let task;
      const run = (args) => {
        return cancel.requested
          ? null
          : _.isFunction(task)
          ? task.apply(agent, args)
          : task;
      };

      const accept = (result) => {
        if (!cancel.requested) {
          value = result;
          agent.trigger("update", result, agent);
        }
      };

      const reject = (err) => {
        if (!cancel.requested) {
          // ANNOYANCE: when cancelled, this task's error is silently suppressed
          agent.trigger("reject", err, agent);
        }
      };

      
      try {
        // When all arguments are resolved, invoke the task then either accept or reject the result.
        const [t, ...rest] = taskAndArguments;
        task = t;
        Promise.all(rest)
          .then(run)
          .then(accept, reject);
      } catch (err) {
        fail(err);
      }
    }

    let value;
    let runTask_debounced = _.debounce(runTask, 0); // ignore multiple simultaneous submissions--reduces noise
    let agent = {
      /**
       * @returns {Object} this agent's current value.
       */
      value:  () => {
        return value;
      },

      
      /**
       * Cancels this agent's most recently submitted task.
       */
      cancel: {
        requested: false,
      },

      /**
       * Submit a new task and arguments to invoke the task with. The task may return a promise for
       * asynchronous tasks, and all arguments may be either values or promises. The previously submitted
       * task, if any, is immediately cancelled.
       * @returns this agent.
       */
      submit: function (...args) {
        // immediately cancel the previous task
        this.cancel.requested = false;
        // this.cancel = cancelFactory()
        // schedule the new task and update the agent with its associated cancel function
        runTask_debounced((this.cancel), args);
      },
    };

    return Object.assign(agent, {...Events});
  }

  /**
   * Parses a URL hash fragment:
   *
   * example: "2013/11/14/0900Z/wind/isobaric/1000hPa/orthographic=26.50,-153.00,1430/overlay=off"
   * output: {date: "2013/11/14", hour: "0900", param: "wind", surface: "isobaric", level: "1000hPa",
   *          projection: "orthographic", orientation: "26.50,-153.00,1430", overlayType: "off"}
   *
   * grammar:
   *     hash   := ( "current" | yyyy / mm / dd / hhhh "Z" ) / param / surface / level [ / option [ / option ... ] ]
   *     option := type [ "=" number [ "," number [ ... ] ] ]
   *
   * @param hash the hash fragment.
   * @param projectionNames the set of allowed projections.
   * @param overlayTypes the set of allowed overlays.
   * @returns {Object} the result of the parse.
   */
  function parse(hash, projectionNames, overlayTypes) {
    let option,
      result = {};
    //             1        2        3          4          5            6      7      8    9
    let tokens =
      /^(current|(\d{4})\/(\d{1,2})\/(\d{1,2})\/(\d{3,4})Z)\/(\w+)\/(\w+)\/(\w+)([\/].+)?/.exec(
        hash
      );
    if (tokens) {
      let date =
        tokens[1] === "current"
          ? "current"
          : tokens[2] +
            "/" +
            zeroPad(tokens[3], 2) +
            "/" +
            zeroPad(tokens[4], 2);
      let hour = isValue(tokens[5]) ? zeroPad(tokens[5], 4) : "";
      result = {
        date: date, // "current" or "yyyy/mm/dd"
        hour: hour, // "hhhh" or ""
        param: tokens[6], // non-empty alphanumeric _
        surface: tokens[7], // non-empty alphanumeric _
        level: tokens[8], // non-empty alphanumeric _
        projection: "orthographic",
        orientation: "",
        topology: TOPOLOGY,
        overlayType: "default",
        showGridPoints: false,
      };
      coalesce(tokens[9], "")
        .split("/")
        .forEach(function (segment) {
          if ((option = /^(\w+)(=([\d\-.,]*))?$/.exec(segment))) {
            if (projectionNames.has(option[1])) {
              result.projection = option[1]; // non-empty alphanumeric _
              result.orientation = coalesce(option[3], ""); // comma delimited string of numbers, or ""
            }
          } else if ((option = /^overlay=(\w+)$/.exec(segment))) {
            if (overlayTypes.has(option[1]) || option[1] === "default") {
              result.overlayType = option[1];
            }
          } else if ((option = /^grid=(\w+)$/.exec(segment))) {
            if (option[1] === "on") {
              result.showGridPoints = true;
            }
          }
        });
    }
    return result;
  }

  /**
   * A Backbone.js Model that persists its attributes as a human readable URL hash fragment. Loading from and
   * storing to the hash fragment is handled by the sync method.
   */
  class Configuration extends Model {
    id = 0;
    _ignoreNextHashChangeEvent = false;
    _projectionNames = null;
    _overlayTypes = null;

    /**
     * @returns {String} this configuration converted to a hash fragment.
     */
    toHash() {
      let attr = this.attributes;
      let dir =
        attr.date === "current" ? "current" : attr.date + "/" + attr.hour + "Z";
      let proj = [attr.projection, attr.orientation].filter(isTruthy).join("=");
      let ol =
        !isValue(attr.overlayType) || attr.overlayType === "default"
          ? ""
          : "overlay=" + attr.overlayType;
      let grid = attr.showGridPoints ? "grid=on" : "";
      return [dir, attr.param, attr.surface, attr.level, ol, proj, grid]
        .filter(isTruthy)
        .join("/");
    }

    /**
     * Synchronizes between the configuration model and the hash fragment in the URL bar. Invocations
     * caused by "hashchange" events must have the {trigger: "hashchange"} option specified.
     */
    sync(method, model, options) {
      switch (method) {
        case "read":
          if (
            options.trigger === "hashchange" &&
            model._ignoreNextHashChangeEvent
          ) {
            model._ignoreNextHashChangeEvent = false;
            return;
          }
          model.set(
            parse(
              window.location.hash.substr(1) || DEFAULT_CONFIG,
              model._projectionNames,
              model._overlayTypes
            )
          );
          break;
        case "update":
          // Ugh. Setting the hash fires a hashchange event during the next event loop turn. Ignore it.
          model._ignoreNextHashChangeEvent = true;
          window.location.hash = model.toHash();
          break;
      }
    }
  }

  /**
   * A Backbone.js Model to hold the page's configuration as a set of attributes: date, layer, projection,
   * orientation, etc. Changes to the configuration fire events which the page's components react to. For
   * example, configuration.save({projection: "orthographic"}) fires an event which causes the globe to be
   * re-rendered with an orthographic projection.
   *
   * All configuration attributes are persisted in a human readable form to the page's hash fragment (and
   * vice versa). This allows deep linking and back-button navigation.
   *
   * @returns {Configuration} Model to represent the hash fragment, using the specified set of allowed projections.
   */
  function buildConfiguration(projectionNames, overlayTypes) {
    let result = new Configuration();
    result._projectionNames = projectionNames;
    result._overlayTypes = overlayTypes;
    return result;
  }

  return {
    isTruthy: isTruthy,
    isValue: isValue,
    coalesce: coalesce,
    floorMod: floorMod,
    distance: distance,
    clamp: clamp,
    proportion: proportion,
    spread: spread,
    zeroPad: zeroPad,
    capitalize: capitalize,
    isFF: isFF,
    isMobile: isMobile,
    isEmbeddedInIFrame: isEmbeddedInIFrame,
    toUTCISO: toUTCISO,
    toLocalISO: toLocalISO,
    ymdRedelimit: ymdRedelimit,
    dateToUTCymd: dateToUTCymd,
    dateToConfig: dateToConfig,
    log: log,
    view: view,
    removeChildren: removeChildren,
    clearCanvas: clearCanvas,
    sinebowColor: sinebowColor,
    extendedSinebowColor: extendedSinebowColor,
    windIntensityColorScale: windIntensityColorScale,
    segmentedColorScale: segmentedColorScale,
    formatCoordinates: formatCoordinates,
    formatScalar: formatScalar,
    formatVector: formatVector,
    loadJson: loadJson,
    distortion: distortion,
    newAgent: newAgent,
    parse: parse,
    buildConfiguration: buildConfiguration,
    Events
  };
})();
