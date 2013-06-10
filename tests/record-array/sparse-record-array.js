module('Sparse record array', {
    setup: function() {
        App.Post = BD.Model.extend({
            title: BD.attr('string')
        });
    },
    teardown: function() {
        BD.store.reset();
    }
});

test('Test AJAX options', function() {
    expect(3);
    BD.ajax = function(hash) {
        equal(hash.type, 'GET');
        equal(hash.url, '/posts');
        deepEqual(hash.data, {
            offset: 0,
            pageSize: 3,
            state: 'draft'
        });
    };
    App.Post.filter({
        pageSize: 3,
        query: {
            state: 'draft'
        }
    });
});

test('Test AJAX options with special url', function() {
    expect(2);
    BD.ajax = function(hash) {
        equal(hash.type, 'GET');
        deepEqual(hash.data, {
            offset: 0,
            pageSize: 3,
            state: 'draft'
        });
    };
    App.Post.filter({
        pageSize: 3,
        query: {
            state: 'draft'
        }
    });
});

test('Test AJAX options for second request', function() {
    expect(3);
    var req = fakeAjax(200, {
        meta: {
            paging: {
                total: 23
            }
        },
        posts: [
            {
                id: 0,
                title: 'Post 0'
            },
            {
                id: 1,
                title: 'Post 1'
            },
            {
                id: 2,
                title: 'Post 2'
            }
        ]
    });
    var records = App.Post.filter({
        pageSize: 3,
        query: {
            state: 'draft'
        }
    });
    records.one('didLoad', function() {
        BD.ajax = function(hash) {
            equal(hash.type, 'GET');
            equal(hash.url, '/posts');
            deepEqual(hash.data, {
                offset: 9,
                pageSize: 3,
                state: 'draft'
            });
        };
        records.objectAt(10);
    });
    req.respond();
});

test('Requesting indexes should load from server', function() {
    var req1 = fakeAjax(200, {
        meta: {
            paging: {
                total: 23
            }
        },
        posts: [
            {
                id: 0,
                title: 'Post 0'
            },
            {
                id: 1,
                title: 'Post 1'
            },
            {
                id: 2,
                title: 'Post 2'
            }
        ]
    });
    var records = App.Post.filter({
        pageSize: 3
    })
    resetAjax();
    equal(records.objectAt(0), null); //These indexes should be null, since length is still 0
    equal(records.objectAt(1), null);
    req1.respond();
    equal(records.get('length'), 23);
    deepEqual(records.objectAt(0).getProperties(['id', 'title']), {id: 0, title: 'Post 0'});
    deepEqual(records.objectAt(1).getProperties(['id', 'title']), {id: 1, title: 'Post 1'});
    deepEqual(records.objectAt(2).getProperties(['id', 'title']), {id: 2, title: 'Post 2'});
    //Trigger a load of another set
    var req2 = fakeAjax(200, {
        meta: {
            paging: {
                total: 23
            }
        },
        posts: [
            {
                id: 9,
                title: 'Post 9'
            },
            {
                id: 10,
                title: 'Post 10'
            },
            {
                id: 11,
                title: 'Post 11'
            }
        ]
    });
    equal(records.objectAt(10), BD.SPARSE_PLACEHOLDER); //These indexes should now be a BD.SPARSE_PLACEHOLDER, since we know have a length
    resetAjax();
    equal(records.objectAt(9), BD.SPARSE_PLACEHOLDER); //These two should not trigger a request
    equal(records.objectAt(11), BD.SPARSE_PLACEHOLDER);
    req2.respond();
    deepEqual(records.objectAt(9).getProperties(['id', 'title']), {id: 9, title: 'Post 9'});
    deepEqual(records.objectAt(10).getProperties(['id', 'title']), {id: 10, title: 'Post 10'});
    deepEqual(records.objectAt(11).getProperties(['id', 'title']), {id: 11, title: 'Post 11'});
});

test('Triggers didLoad every time something is loaded', function() {
    var didLoadCount = 0;
    var req1 = fakeAjax(200, {
        meta: {
            paging: {
                total: 23
            }
        }
    });
    var records = App.Post.filter({
        pageSize: 3
    });
    records.on('didLoad', function() {
        didLoadCount++;
    });
    req1.respond();
    var req2 = fakeAjax(200, {
        meta: {
            paging: {
                total: 23
            }
        }
    });
    records.objectAt(9);
    req2.respond();
    equal(didLoadCount, 2);
});

test('Destroying a loading sparse array', function() {
    var records;
    var req = fakeAjax(200);
    Ember.run(function() {
        records = App.Post.filter({
            pageSize: 3
        });
        records.on('didLoad', function() {
            fail('Should not be called.');
        });
        records.destroy();
    });
    Ember.run(function() {
        ok(records.get('isDestroyed'), 'Record array should be destroyed');
        ok(req.isAborted, 'AJAX request should be aborted');
    });
});

test('Deleting a record that is in a sparse array', function() {
    var req1 = fakeAjax(200, {
        meta: {
            paging: {
                total: 23
            }
        },
        posts: [
            {
                id: 0,
                title: 'Post 0'
            }
        ]
    });
    var records = App.Post.filter({
        pageSize: 1
    });
    equal(records.get('length'), 0);
    req1.respond();
    equal(records.get('length'), 23);
    var r = App.Post.find(0);
    var req2 = fakeAjax(200);
    r.deleteRecord();
    req2.respond();
    equal(records.get('length'), 22);
});

test('Loading a record that belongs in a sorted sparse array', function() {
    var req = fakeAjax(200, {
        meta: {
            paging: {
                total: 23
            }
        },
        posts: [
            {
                id: 0,
                title: 'Post 0'
            },
            {
                id: 1,
                title: 'Post 1'
            },
            {
                id: 2,
                title: 'Post 2'
            }
        ]
    });
    var records = App.Post.filter({
        pageSize: 3,
        sortProperty: 'title'
    })
    req.respond();
    //Insert 4 after 2
    App.Post.load({
        id: 4,
        title: 'Post 4'
    });
    equal(records.objectAt(2).get('id'), 2);
    equal(records.objectAt(3).get('id'), 4);
    //Insert 3, which should go between 2 and 3
    App.Post.load({
        id: 3,
        title: 'Post 3'
    });
    equal(records.objectAt(2).get('id'), 2);
    equal(records.objectAt(3).get('id'), 3);
    equal(records.objectAt(4).get('id'), 4);
    //Change the title of 3, so that it should be first
    App.Post.find(3).set('title', 'A post that goes first');
    equal(records.objectAt(0).get('id'), 3);
    equal(records.objectAt(1).get('id'), 0);
    equal(records.objectAt(2).get('id'), 1);
    equal(records.objectAt(3).get('id'), 2);
    equal(records.objectAt(4).get('id'), 4);
});
