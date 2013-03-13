﻿define([
        'ember',
        'signalr',
        'signalr.hubs',
/*        'app/models/user',
        "app/views/main-views",
        "app/views/access-views",
        "app/views/item-views"
*/
    ], function(em, connection, hub) {

        var app = em.Application.create({
            name: "NuGet",
        });

        app.deferReadiness();

        app.IndexingModel = em.Object.extend({
            status: {},
            hub: undefined,
            init: function() {
                console.log("Connecting to SignalR status hub");
                var self = this;
                var setStatusCallback = function(status) {
                    self.set('status', status);
                };

                $.connection.hub.logging = true;

                hub = $.connection.status;

                hub.client.updateStatus = setStatusCallback;

                hub.connection.stateChanged(function(change) {
                    var isConnected = change.newState === $.signalR.connectionState.connected;
                    self.set('isConnected', isConnected);

                    if (isConnected) {
                        hub.server.getStatus().done(setStatusCallback);
                    } else {
                        setStatusCallback({});
                    }
                });

                this.set('hub', hub);

                $.connection.hub.start();
            },
            synchronize: function() {
                $.ajax("api/indexing/synchronize", { type: 'POST' });
            },
            cancel: function() {
                $.ajax("api/indexing/cancel", { type: 'POST' });
            },
            isRunning: function() {
                return this.status.synchronizationState != 'Idle';
            }.property('status'),
        });

        em.PaginationSupport = em.Mixin.create({
            hasPaginationSupport: true,
            total: 0,
            page: 0,
            pageSize: 10,
            didRequestPage: em.K,

            first: function() {
                return this.get('page') * this.get('pageSize') + 1;
            }.property('page', 'pageSize').cacheable(),

            last: function() {
                return Math.min((this.get('page') + 1) * this.get('pageSize'), this.get('total'));
            }.property('page', 'pageSize', 'total').cacheable(),

            hasPrevious: function() {
                return this.get('page') > 0;
            }.property('page').cacheable(),

            hasNext: function() {
                return this.get('last') < this.get('total');
            }.property('last', 'total').cacheable(),

            nextPage: function() {
                if (this.get('hasNext')) {
                    this.incrementProperty('page');
                }
            },

            previousPage: function() {
                if (this.get('hasPrevious')) {
                    this.decrementProperty('page');
                }
            },

            totalPages: function() {
                return Math.ceil(this.get('total') / this.get('pageSize'));
            }.property('total', 'pageSize').cacheable(),

            pageDidChange: function() {
                this.didRequestPage(this.get('page'));
            }.observes('page')
        });

        app.Search = em.Object.extend(em.PaginationSupport, {
            data: {},
            query: '',
            loaded: false,
            totalBinding: 'data.totalHits',
            hits: function() {
                var copy = [];
                var hits = this.get('data.hits');
                if (!hits) return copy;
                for (var i = 0; i < hits.length; i++) {
                    var hit = hits[i];
                    var c = {};
                    for (var attr in hit) {
                        c[attr] = hit[attr];
                    }
                    var tagQueries = [];
                    if (!hit.tags) hit.tags = '';
                    var tags = hit.tags.split(' ');
                    c.tags = [];
                    for (var j = 0; j < tags.length; j++) {
                        if (tags[j] === '') continue;
                        tagQueries.push(tags[j]);
                    }
                    c.tags = tagQueries;
                    copy.push(c);
                }
                return copy;
            }.property('data.hits').cacheable(),

            search: function(query) {
                console.log('set query to ' + query);
                this.set('loaded', false);
                this.setProperties({ page: 0, query: query });
            },

            queryAndPage: function() {
                return { query: this.get('query'), page: this.get('page') };
            }.property('query', 'page').cacheable(),

            queryOrPageChanged: function() {
                this.load();
            }.observes('queryAndPage'),

            load: function() {
                var self = this;

                console.log('load search results for query ' + this.get('query') + ' page ' + this.get('page'));

                $.ajax("api/v2/package", {
                    type: 'GET',
                    data: {
                        query: self.get('query'),
                        offset: self.get('page') * self.get('pageSize'),
                        count: self.get('pageSize')
                    },
                    success: function(data, status, xhr) {
                        self.set('data', data);
                        self.set('loaded', true);
                    }
                });
            },
        });

        app.ApplicationController = em.Controller.extend({
            needs: 'search',
            queryBinding: em.Binding.oneWay('controllers.search.query'),
            search: function() {
                this.transitionToRoute('search', this.get('query'));
            }
        });

        app.SearchController = em.ObjectController.extend({
            query: '',
            search: function(query) {
                console.log('searchController.search ' + query);
                console.log('searchController model ' + this.get('model'));
                this.set('query', query);
                this.get('model').search(query);
            },
            nextPage: function() {
                this.get('model').nextPage();
            },
            previousPage: function() {
                this.get('model').previousPage();
            }
        });

        app.AdminController = em.ObjectController.extend({
            synchronize: function() {
                app.indexingModel.synchronize();
            },
            cancel: function() {
                app.indexingModel.cancel();
            }
        });

        app.FooterView = em.View.extend({
            templateName: 'footer',
            tagName: 'footer',
            contentBinding: 'App.indexingModel.status'
        });

        app.Router.map(function() {
            this.route('index', { path: '/' });
            this.route('admin');
            this.route('search', { path: '/package/search/:query' });
            this.route('viewPackage', { path: '/package/:id/:version' });
        });

        app.AdminRoute = em.Route.extend({
            model: function() {
                return app.indexingModel;
            }
        });

        app.SearchRoute = em.Route.extend({
            setupController: function(controller, params) {
                var query = params;
                if (params && params.query) {
                    query = params.query;
                }

                controller.set('model', app.Search.create());
                controller.search(query);
            }
        });

        app.ViewPackageRoute = em.Route.extend({
            setupController: function(controller, params) {
                controller.set('id', params.id);
                controller.set('version', params.version);
            },
            serialize: function(model) {
                return { id: model.id, version: model.version };
            },
        });

        $(function() {
            app.indexingModel = app.IndexingModel.create();
            app.advanceReadiness();
        });

        $(document).ready(function() {
            $(".package-icon").error(function() {
                $(this).unbind("error").attr("src", "http://nuget.org/Content/Images/packageDefaultIcon-50x50.png");
            });
        });

        return app;
    });