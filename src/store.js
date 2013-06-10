BD.Store = Em.Object.extend({

    init: function() {
        this._super();
        this._resetContainers();
    },
    
    _typeMapFor: function(type) {
        type = BD.resolveType(type);
        var guidForType = Ember.guidFor(type);
        if (!this._typeMaps[guidForType]) {
            this._typeMaps[guidForType] = {
                allIsLoaded: false,
                idToRecord: {},
                recordArrayQueryObservers: {},
                recordArrayComparatorObservers: {}
            };
        }
        return this._typeMaps[guidForType];
    },
    recordForTypeAndId: function(type, id) {
        return this._typeMapFor(type).idToRecord[id];
    },
    eachRecordOfType: function(type, callback, context) {
        var typeMap = this._typeMapFor(type),
            idToRecord = typeMap.idToRecord,
            id;
        for (id in idToRecord) {
            if (!idToRecord.hasOwnProperty(id)) continue;
            callback.call(context, idToRecord[id]);
        }
    },

    findByClientId: function(clientId) {
        var r = this._cidToRecord[clientId];
        Ember.assert('No record with clientId "'+clientId+'" has been loaded.', r);
        return r;
    },
    _instantiateUnloadedRecord: function(type, id) {
        var r = type._create({});
        this._didUpdateId(r, id);
        return r;
    },
    find: function(type, id) {
        if (Ember.isNone(id)) {
            id = {};
        }
        if (typeof id === 'object') {
            return this.findByQuery(type, id);
        }
        type = BD.resolveType(type);
        var r = this.recordForTypeAndId(type, id);
        if (r) {
            return r;
        }
        r = this._instantiateUnloadedRecord(type, id);
        this._findOne(type, r, id);
        return r;
    },
    findByReference: function(reference) {
        var p = this.parseReference(reference);
        return this.find(p.type, p.id);
    },
    findByIdQuery: function(type, id, query) {
        type = BD.resolveType(type);
        var r = this.recordForTypeAndId(type, id);
        if (!r) {
            r = this._instantiateUnloadedRecord(type, id);
        }
        this._findOne(type, r, id, query);
        return r;
    },
    findByIdInclude: function(type, id, include) {
        return this.findByIdQuery(type, id, {include: include});
    },
    _findOne: function(type, r, id, query) {
        var self = this;

        r.set('isLoading', true);

        var success = function(payload) {
            r.set('isLoading', false);
            self.sideload(payload);
        };

        var error = function(payload, status) {
            var msg;
            if (status == 422 && payload) {
                msg = payload.errorMessage;
            } else {
                msg = 'We\'re sorry, but the record could currently not be loaded. Please try again.';
            }
            BD.printServerError(msg);
        };

        this.get('adapter').findOne(this, type, r, id, query, success, error);
    },
    findMany: function(type, ids) {
        type = BD.resolveType(type);
        var records = [];
        ids.forEach(function(id) {
            if (typeof id === 'object') {
                records.push(this.findByClientId(id.clientId));
            } else {
                records.push(this.find(type, id));
            }
        }, this);
        var recordArray = BD.FindRecordArray.create({
            type: type,
            isLoaded: true,
            content: Em.A(records)
        });
        return recordArray;
    },

    findByQuery: function(type, query) {
        type = BD.resolveType(type);

        var self = this;

        var recordArray = BD.FindRecordArray.create({
            type: type,
            content: Em.A(),
            query: query
        });

        var complete = function() {
            recordArray.set('ajaxRequest', null);
        };

        var success = function(payload) {
            recordArray.trigger('willLoad', payload);
            self.sideload(payload,
                          BD.pluralize(self._rootForType(type)),
                          recordArray);
            recordArray.set('isLoaded', true);
            recordArray.trigger('didLoad', payload);
        };

        var error = function(payload, status) {
            var msg = 'We\'re sorry, but the records could currently not be loaded. Please try again.';

            if (status === 0) {
                msg = 'We\'re sorry, but the records could currently not be loaded. Please check your internet connection and try again.';
            }

            if (status === 422 && payload) {
                msg = payload.errorMessage;
            }

            BD.printServerError(msg);
        };

        var ajaxRequest = this.get('adapter').findByQuery(
            this, type, query, success, error, complete
        );

        recordArray.set('ajaxRequest', ajaxRequest);
        return recordArray;
    },

    _normalizeSaveOptions: function(options) {
        options = options || {};
        //Make sure that options.embed is an array
        if (options.embed && !Em.isArray(options.embed)) {
            options.embed = [options.embed];
        } else if (!options.embed) {
            options.embed = [];
        }
        return options;
    },
    saveRecord: function(r, options) {
        options = this._normalizeSaveOptions(options);
        var self = this;
        var promise = BD.ModelOperationPromise.create();
        //Don't save if the record is clean
        if (!r.get('isDirty') && !options.properties) {
            setTimeout(function() {
                promise.trigger('complete');
                promise.trigger('success');
            }, 1);
            return promise;
        }

        //Payload
        var data = {};
        data[this._rootForType(r.constructor)] = r.serialize(options);

        var success = function(payload) {
            r.didCommit(options);
            self.sideload(payload);
            promise.trigger('complete');
            promise.trigger('success', payload);
        };

        var error = function(payload, status) {
            var errorMessage;
            if (status == 422 && payload) {
                errorMessage = payload.errorMessage;
                self._handleValidationErrors(payload);
            } else {
                errorMessage = 'We\'re sorry but we couldn\'t save your data. Please try again.';
                r.set('error', errorMessage);
            }
            promise.trigger('complete');
            promise.trigger('error', errorMessage, payload);
        };

        //Make PUT/POST request
        this.get('adapter').saveRecord(this, r, data, success, error);

        return promise;
    },
    commitTransaction: function(transaction) {
        Ember.assert('This transaction has already been committed.', !transaction.get('hasCommitted'));
        transaction.set('hasCommitted', true);
        //If there are no records in the transaction we just stop here
        if (transaction.get('length') == 0) {
            setTimeout(function() {
                transaction.trigger('complete');
                transaction.trigger('success', null);
            }, 0);
            return;
        }
        //Check bulk support
        var type = transaction.get('type');
        Ember.assert(type.toString()+' does not support bulk saving. Try reopening the class with `supportsBulkSave: true`.', type.supportsBulkSave);
        //Commit the bulk transaction
        this._commitTransactionBulk(transaction);
        return transaction;
    },
    _commitTransactionBulk: function(transaction) {
        var self = this,
            serializedItems = [],
            type = transaction.get('type'),
            rootPlural = BD.pluralize(this._rootForType(type)),
            data  = {};
        //Serialize records
        transaction.get('records').forEach(function(r, options) {
            //Don't add if the record is clean
            if (!r.get('isDirty') && !options.properties) {
                return;
            }
            serializedItems.push(r.serialize(options));
        }, this);
        //If there were no dirty records we just stop here
        if (serializedItems.length == 0) {
            setTimeout(function() {
                transaction.trigger('complete');
                transaction.trigger('success', null);
            }, 0);
            return;
        }
        //Payload
        data[rootPlural] = serializedItems;

        var success = function(payload) {
            transaction.get('records').forEach(function(r, options) {
                r.didCommit(options);
            }, self);
            self.sideload(payload);
            transaction.trigger('complete');
            transaction.trigger('success', payload);
        };

        var error = function(payload, status) {
            var errorMessage;
            if (status == 422 && payload) {
                errorMessage = payload.errorMessage;
                self._handleValidationErrors(payload);
            } else {
                errorMessage = 'We\'re sorry but we couldn\'t save your data. Please try again.';
                transaction.get('records').forEach(function(r, options) {
                    r.set('error', errorMessage);
                }, self);
            }
            transaction.trigger('complete');
            transaction.trigger('error', errorMessage, payload);
        };

        this.get('adapter').commitTransactionBulk(this, type, rootPlural, data, success, error);
    },
    _handleValidationErrors: function(payload) {
        if (!payload.validationErrors) {
            return;
        }
        _.each(payload.validationErrors, function(rawErrors, clientId) {
            var r = this.findByClientId(clientId);
            if (!r) {
                return;
            }
            var attributeErrors = Ember.Object.create();
            var rawAttributeErrors = rawErrors.attributes;
            if (rawAttributeErrors) {
                r.eachAttribute(function(key) {
                    if (rawAttributeErrors[key]) {
                        attributeErrors.set(key, rawAttributeErrors[key]);
                    }
                }, this);
                r.eachBelongsTo(function(key) {
                    if (rawAttributeErrors[key+'Id']) {
                        attributeErrors.set(key, rawAttributeErrors[key+'Id']);
                    }
                }, this);
            }
            r.set('error', rawErrors.message);
            r.set('errors', attributeErrors);
        }, this);
    },

    _prepareRecordForDeletion: function(r) {
        var id = r.get('id'),
            isEmbedded = r.get('isEmbedded');
        //Set the record as dirty
        r.becomeDirty();
        r.set('isDeleted', true);
        //Dirty the parent, if embedded
        if (isEmbedded && !r.get('isNew')) {
            r.getParent().didDeleteEmbeddedRecord(r);
        }
        //Remove all belongsTo
        r.eachBelongsTo(function(key) {
            r.set(key, null);
        }, this);
    },
    deleteRecord: function(r) {
        var self = this,
            id = r.get('id'),
            isEmbedded = r.get('isEmbedded'),
            promise = BD.ModelOperationPromise.create();
        this._prepareRecordForDeletion(r);
        //If the record hasn't been created yet, there is no need to contact the server
        if (r.get('isNew')) {
            r.unload();
            promise.trigger('complete');
            promise.trigger('success', null);
            return;
        }
        //If the record is embedded, then don't send DELETE request
        if (isEmbedded) {
            promise.trigger('complete');
            promise.trigger('success', null);
            return;
        }

        var success = function(payload) {
            r.unload();
            self._unloadServerDeletedRecords(payload);
            promise.trigger('complete');
            promise.trigger('success', payload);
        };

        var error = function(payload, status) {
            self._handleDeleteServerError(promise, payload, status);
        };

        //Make DELETE request
        this.get('adapter').deleteRecord(this, r, id, success, error);

        return promise;
    },
    deleteRecords: function(records) {
        var self = this,
            type,
            recordsToDelete = [],
            promise = BD.ModelOperationPromise.create();

        records.forEach(function(r) {
            var id = r.get('id'),
                isEmbedded = r.get('isEmbedded');
            if (!type) {
                type = r.constructor;
            } else {
                Ember.assert('A bulk delete transaction can only contain records of the same type. This transaction already has '+type.toString()+' records, but you tried to add a '+r.constructor.toString()+' record.', r.constructor == type);
            }
            this._prepareRecordForDeletion(r);
            //If the record hasn't been created yet, there is no need to contact the server
            if (r.get('isNew')) {
                r.unload();
                return;
            }
            //If the record is embedded, then don't send DELETE request
            if (isEmbedded) {
                return;
            }
            recordsToDelete.push(r);
        }, this);
        //If there is nothing to delete
        if (recordsToDelete.length == 0) {
            promise.trigger('complete');
            promise.trigger('success', null);
            return;
        }

        var success = function(payload) {
            recordsToDelete.forEach(function(r) {
                r.unload();
            });
            self._unloadServerDeletedRecords(payload);
            promise.trigger('complete');
            promise.trigger('success', payload);
        };

        var error = function(payload, status) {
            self._handleDeleteServerError(promise, payload, status);
        };

        //Make DELETE request
        this.get('adapter').deleteRecords(this, type, recordsToDelete, success, error);
        return promise;
    },
    _handleDeleteServerError: function(promise, payload, status) {
        var errorMessage;
        if (status == 422 && payload) {
            errorMessage = payload.errorMessage;
        } else {
            errorMessage = 'We\'re sorry, but the record could currently not be deleted. Please try again.';
        }
        promise.trigger('complete');
        promise.trigger('error', errorMessage, payload);
    },
    _unloadServerDeletedRecords: function(payload) {
        var meta = payload.meta,
            deletedRecords;
        if (meta) {
            deletedRecords = meta.deletedRecords;
            if (deletedRecords) {
                _.each(deletedRecords, function(ids, typeName) {
                    var type = BD.lookupTypeByName(typeName);
                    if (!type) {
                        return;
                    }
                    ids.forEach(function(id) {
                        var deletedRecord = this.recordForTypeAndId(type, id);
                        if (deletedRecord) {
                            deletedRecord.unload();
                        }
                    }, this);
                }, this);
            }
        }
    },
    didUnloadRecord: function(r) {
        var cid = r.get('clientId'),
            id = r.get('id');
        delete this._cidToRecord[cid];
        delete this._typeMapFor(r.constructor).idToRecord[id];
    },

    _rootForType: function(type) {
        return Ember.get(type, 'root');
    },
    
    sideload: function(payload, root, recordArray) {
        var allRecords = [], rootRecords;
        for (var key in payload) {
            //Skip some properties
            if (!payload.hasOwnProperty(key)) continue;
            if (key === 'meta') continue;
            //Find type
            var type = BD.lookupTypeByName(key);
            if (!type) {
                Ember.warn('JSON payload had unknown key "'+key+'"');
                continue;
            }
            //Load records of this type
            var records = this._loadMany(type, payload[key]);
            allRecords.push(records);
            if (root == key) {
                rootRecords = records;
            }
        }
        //Materialize records
        this._materializeRecords();
        //Add root records, if any to the RecordArray
        if (rootRecords) {
            recordArray.set('content', rootRecords);
        }
    },
    loadAll: function(type, dataItems) {
        var typeMap = this._typeMapFor(type);
        typeMap.allIsLoaded = true;
        BD.set('loadedAll.'+BD.pluralize(Em.get(type, 'root')), true);
        return this.loadMany(type, dataItems);
    },
    allOfTypeIsLoaded: function(type) {
        var typeMap = this._typeMapFor(type);
        return typeMap.allIsLoaded; 
    },
    loadMany: function(type, dataItems) {
        var records = this._loadMany(type, dataItems);
        this._materializeRecords();
        return records;
    },
    _loadMany: function(type, dataItems) {
        var records = [];
        if (Em.isArray(dataItems)) {
            for (var i = 0; i < dataItems.length; i++) {
                records.push(this._load(type, dataItems[i]));
            }
        } else {
            records.push(this._load(type, dataItems));
        }
        return records;
    },
    load: function(type, data) {
        var r = this._load(type, data);
        this._materializeRecords();
        return r;
    },
    _load: function(type, data) {
        var id = data.id,
            cid = data._clientId,
            r;
        //Try to find record based on clientId or id
        if (cid) {
            r = this.findByClientId(cid);
        } else {
            r = this.recordForTypeAndId(type, id);
        }
        //If record was found, then update its isNew states
        if (r) {
            //Created
            if (r.get('isNew')) {
                r.set('isNew', false);
                this._didUpdateId(r, id);
                r.trigger('didCreate');
            }
        } else {
            //If no record was found, then instantiate a new one
            r = type._create({
                isLoaded: true
            });
            this._didUpdateId(r, id);
        }
        //Update data
        r.loadData(data);
        this._unmaterializedRecords.push(r);
        return r;
    },
    _materializeRecords: function() {
        this._unmaterializedRecords.forEach(function(r) {
            r.materializeData();
        });
        this._unmaterializedRecords.forEach(function(r) {
            if (!r.get('isLoaded')) {
                r.set('isLoaded', true);
            }
            r.trigger('didLoad');
        });
        this._unmaterializedRecords = [];
    },

    didInstantiateRecord: function(r) {
        this._clientIdCounter++;
        var clientId = this._clientIdCounter;
        r.set('clientId', clientId);
        this._cidToRecord[clientId] = r;
        this._checkRecordArrayObservers(r, '_all');
    },
    _didUpdateId: function(r, id) {
        r.set('id', id);
        this._typeMapFor(r.constructor).idToRecord[id] = r;
    },

    /**
     @param {string} type The model class to load records of.
     @param {Object} options Properties to pass on the filtered record array. `type` will automatically be set.
                     See {@link BD.FilteredRecordArray} for info on which options you can set.
     @return BD.FilteredRecordArray
    */
    filter: function(type, options) {
        type = BD.resolveType(type);
        options = options || {};
        var typeMap = this._typeMapFor(type),
            recordArray;
        //Create record array
        options.type = type;
        recordArray = BD.FilteredRecordArray.create(options);
        var guid = Em.guidFor(recordArray);
        this._recordArrays[ guid] = recordArray;
        //Add query properties to observe
        recordArray.get('queryObservers').forEach(function(property) {
            if (!typeMap.recordArrayQueryObservers[property]) {
                typeMap.recordArrayQueryObservers[property] = {};
            }
            typeMap.recordArrayQueryObservers[property][guid] = recordArray;
        });
        //Add comparator properties to observe
        recordArray.get('comparatorObservers').forEach(function(property) {
            if (!typeMap.recordArrayComparatorObservers[property]) {
                typeMap.recordArrayComparatorObservers[property] = {};
            }
            typeMap.recordArrayComparatorObservers[property][guid] = recordArray;
        });
        //Return the record array
        return recordArray;
    },
    all: function(type) {
        return this.filter(type);
    },
    recordAttributeDidChange: function(r, key) {
        if (this._recordAttributeDidChangeIsSuspended) {
            this._recordAttributeDidChangeQueue.push(arguments);
            return;
        }
        this._checkRecordArrayObservers(r, key);
    },
    _checkRecordArrayObservers: function(r, key) {
        var type = r.constructor,
            typeMap = this._typeMapFor(type),
            queryObservers = typeMap.recordArrayQueryObservers[key],
            comparatorObservers = typeMap.recordArrayComparatorObservers[key];
        if (queryObservers) {
            _.each(queryObservers, function(recordArray) {
                recordArray.checkRecordAgainstQuery(r);
            });
        }
        if (comparatorObservers) {
            _.each(comparatorObservers, function(recordArray) {
                recordArray.checkRecordAgainstComparator(r);
            });
        }
    },
    suspendRecordAttributeDidChange: function() {
        this._recordAttributeDidChangeIsSuspended = true;
    },
    resumeRecordAttributeDidChange: function() {
        this._recordAttributeDidChangeIsSuspended = false;
        this._recordAttributeDidChangeQueue.forEach(function(args) {
            this.recordAttributeDidChange.apply(this, args);
        }, this);
        this._recordAttributeDidChangeQueue = [];
    },
    willDestroyFilteredRecordArray: function(recordArray) {
        var guid = Em.guidFor(recordArray),
            typeMap = this._typeMapFor(recordArray.get('type'));
        delete this._recordArrays[guid];
        recordArray.get('queryObservers').forEach(function(key) {
            if (typeMap.recordArrayQueryObservers[key]) {
                delete typeMap.recordArrayQueryObservers[key][guid];
            }
        });
        recordArray.get('comparatorObservers').forEach(function(key) {
            if (typeMap.recordArrayComparatorObservers[key]) {
                delete typeMap.recordArrayComparatorObservers[key][guid];
            }
        });
    },
    
    allLocal: function(type) {
        var records = Em.A(),
            typeMap = this._typeMapFor(type),
            idToRecord = typeMap.idToRecord,
            id;
        for (id in idToRecord) {
            if (!idToRecord.hasOwnProperty(id)) continue;
            records.pushObject(idToRecord[id]);
        }
        return records;
    },

    parseReference: function(reference) {
        var s = reference.split(':'),
            type = BD.lookupTypeByName(s[0]),
            id = s[1];
        Ember.assert('Unknown type in API reference "'+reference+'".', type);
        Ember.assert('No ID contained in API reference "'+reference+'".', id);
        return {
            type: type,
            id: s[1]
        };
    },
    
    reset: function() {
        this.set('isResetting', true);
        _.each(this._cidToRecord, function(r) {
            r.unload();
        });
        _.each(this._recordArrays, function(recordArray) {
            recordArray.destroy();
        });
        this._resetContainers();
        this.set('isResetting', false);
    },
    _resetContainers: function() {
        this._clientIdCounter = 0;
        this._cidToRecord = {};
        this._typeMaps = {};
        this._unmaterializedRecords = [];
        this._recordAttributeDidChangeQueue = [];
        this._recordArrays = {};
    }
    
});

BD.store = BD.Store.create({
  adapter: BD.RestAdapter.create({})
});
