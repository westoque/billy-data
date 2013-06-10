BD.FakeAjax = Ember.Object.extend({

    DELAY: 500,

    init: function() {
        this.timeoutId = null;
    },

    abort: function() {
        if (!this.timeoutId) {
            Ember.warn('There is no scheduled callback');
        }

        this.clearTimeout(this.timeoutId);
        this.timeoutId = null;
    },

    schedule: function(cb) {
        this.timeoutId = this.setTimeout(cb, this.DELAY);
    },

    clearTimeout: function(id) {
        return window.clearTimeout(id);
    },

    setTimeout: function(cb, delay) {
        return window.setTimeout(cb, delay);
    }

});

BD.FixtureAdapter = Em.Object.extend({

    reset: function(store, type, success) {
        success(type.FIXTURES = $.extend(true, [], type.DEFAULT_FIXTURES));
    },

    rawFixturesForType: function(type) {
        if (!type.FIXTURES) {
            type.FIXTURES = [];
        }

        if (!type.DEFAULT_FIXTURES) {
            type.DEFAULT_FIXTURES = $.extend(true, [], type.FIXTURES);
        }

        return type.FIXTURES;
    },

    deleteRecords: function(store, type, records, success, error) {
        return this._simulateRemoteCall(function() {
            this._didDeleteRecords(store, type, records, success, error);
        }, this);
    },

    _didDeleteRecords: function(store, type, records, success, error) {
        var fixtures = this.rawFixturesForType(type);
        records.forEach(function(record) {
            this._remove(type, record.get('id'));
        }, this);
        success({ meta: { status: 200, success: true } });
    },

    deleteRecord: function(store, r, id, success, error) {
        return this._simulateRemoteCall(function() {
            this._didDeleteRecord(store, r, id, success, error);
        }, this);
    },

    _didDeleteRecord: function(store, r, id, success, error) {
        this._remove(r.constructor, id);
        success({ meta: { status: 200, success: true } });
    },

    findOne: function(store, type, r, id, query, success, error) {
        return this._simulateRemoteCall(function() {
            this._didFindOne(store, type, r, id, query, success, error);
        }, this);
    },

    _didFindOne: function(store, type, r, id, query, success, error) {
        // TODO: Remove redundancy from #findOne
        var fixtures = this.rawFixturesForType(type);
        var payload = { meta: { statusCode: 200, success: true } };
        var fixture = fixtures.find(function(item) { return item.id == id });
        payload[store._rootForType(type)] = fixture;
        success(payload);
    },

    findByQuery: function(store, type, query, success, error, complete) {
        return this._simulateRemoteCall(function() {
            this._didFindByQuery(store, type, query, success, error, complete);
        }, this);
    },

    _didFindByQuery: function(store, type, query, success, error, complete) {
        var payload = {};
        payload.meta = { statusCode: 200, success: true };
        payload[BD.pluralize(store._rootForType(type))] = this.rawFixturesForType(type);
        success(payload);
    },

    saveRecord: function(store, r, data, success, error) {
        return this._simulateRemoteCall(function() {
            this._didSaveRecord(store, r, data, success, error);
        }, this);
    },

    _didSaveRecord: function(store, r, data, success, error) {
        this._persist(r.constructor, data);
        success({ meta: { statusCode: 200, success: true } });
    },

    commitTransactionBulk: function(store, type, rootPlural, data, success, error) {
        return this._simulateRemoteCall(function() {
            this._didCommitTransactionBulk(store, type, rootPlural, data, success, error);
        }, this);
    },

    _didCommitTransactionBulk: function(store, type, rootPlural, data, success, error) {
        data[rootPlural].forEach(function(obj) {
            this._persist(type, obj);
        }, this);
        success({ meta: { statusCode: 200, success: true } });
    },

    _remove: function(type, id) {
        var fixtures = this.rawFixturesForType(type);
        fixtures.find(function(item, idx) {
            if (item.id == id) {
                fixtures.splice(idx, 1);
                return true;
            }
        });
    },

    _persist: function(type, obj) {
        var fixtures = this.rawFixturesForType(type);

        if (obj.id) {
            fixtures.find(function(item, idx) {
                if (item.id == obj.id) {
                    fixtures[idx] = $.extend({}, item, obj);
                    return true;
                }
            });
        } else {
            obj.id = this._incrementIdInFixtures(type);
            fixtures.push(obj);
        }
    },

    _incrementIdInFixtures: function(type) {
        var fixtures = this.rawFixturesForType(type);
        return fixtures[fixtures.length - 1].id + 1;
    },

    _simulateRemoteCall: function(callback, context) {
        return this._schedule(function() {
            // Asynchronous, but at the of the runloop with zero latency
            Ember.run.once(context, callback);
        });
    },

    _schedule: function(callback) {
        var ajax = BD.FakeAjax.create();
        ajax.schedule(callback);
        return ajax;
    }

});
