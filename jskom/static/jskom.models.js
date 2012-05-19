
jskom.Models.Session = Backbone.Model.extend({
    url: function() {
        var base = '/sessions/';
        if (this.isNew()) return base;
        return base + encodeURIComponent(this.id);;
    },
    
    defaults: {
        pers_name: null,
        password: null, // TODO: Somehow not store password in model
        pers_no: null,
        client: {
            name: "jskom",
            version: jskom.version
        }
    },
    
    validate: function(attrs) {
        if (!attrs.pers_name) {
            // ugly hack to make them look the same as jqXHR...
            return { responseText: "can't have an empty person name" };
        }
    },
},
{
    // Class methods here
    
    _getSessionIdFromCookie: function() {
        var session_id = $.cookie('session_id')
        console.log("getSessionIdFromCookie: " + session_id)
        return session_id;
    },
    
    fetchCurrentSession: function(callback) {
        var currentSessionId = jskom.Models.Session._getSessionIdFromCookie();
        if (!currentSessionId || currentSessionId == '') {
            console.log("currentSessionId: " + currentSessionId);
            callback(new jskom.Models.Session());
        } else {
            var currentSession = new jskom.Models.Session({
                id: currentSessionId
            });
            currentSession.fetch({
                success: function(session, resp) {
                    console.log("currentSession.fetch - success");
                    callback(session);
                },
                error: function(session, resp) {
                    console.log("currentSession.fetch - error");
                    callback(new jskom.Models.Session());
                }
            });
        }
    }
});

jskom.Models.Recipient = Backbone.Model.extend({
    defaults: {
        type: null,
        conf_name: null,
        conf_no: null
    }
});

jskom.Collections.RecipientList = Backbone.Collection.extend({
    model: jskom.Models.Recipient
});

jskom.Models.Text = Backbone.Model.extend({
    idAttribute: 'text_no',
    
    url: function() {
        var base = '/texts/';
        if (this.isNew()) return base;
        return base + this.get('text_no');
    },
    
    defaults: {
        text_no: null,
        creation_time: null,
        author: null,
        comment_to_list: null,
        comment_in_list: null,
        content_type: null,
        subject: '',
        body: ''
    },
    
    initialize: function(options) {
        this._fetchDeferred = null; // created when deferredFetch is called the first time.
        this.set({ recipient_list: new jskom.Collections.RecipientList() });
    },
    
    toJSON: function() {
        var json = _.clone(this.attributes);
        if (this.get('recipient_list')) {
            json.recipient_list = this.get('recipient_list').map(function(recipient) {
                return recipient.toJSON();
            });
        } else {
            json.recipient_list = null;
        }
        return json;
    },
    
    parse: function(resp, xhr) {
        var recipientListJson = resp.recipient_list;
        var recipients = _.map(recipientListJson, function(recipientJson) {
            var r = new jskom.Models.Recipient();
            r.set(r.parse(recipientJson), { silent: true });
            return r;
        });
        // overwrite the json with the parsed collection
        resp.recipient_list = new jskom.Collections.RecipientList(recipients);
        return resp;
    },

    deferredFetch: function() {
        if (!this._fetchDeferred) {
            var self = this;
            this._fetchDeferred = this.fetch().done(
                function(data) {
                    console.log("text.deferredFetch(" + self.get('text_no') + ") - success");
                }
            ).fail(
                function(jqXHR, textStatus) {
                    console.log("text.deferredFetch(" + self.get('text_no') + ") - error");
                }
            );
        }
        return this._fetchDeferred;
    },
    
    markAsReadGlobal: function() {
        return new jskom.Models.GlobalReadMarking({ text_no: this.get('text_no') }).save();
    },
    
    markAsUnreadGlobal: function() {
        return new jskom.Models.GlobalReadMarking({ text_no: this.get('text_no') }).destroy();
    },
    
    makeCommentTo: function(otherText) {
        otherText.get('recipient_list').each(function(r) {
            // Only copy "to" recipients, not "cc" or "bcc".
            if (r.get('type') == 'to') {
                this.get('recipient_list').add(r.clone());
            }
        }, this);
        this.set({
            comment_to_list: [
                { type: 'comment', text_no: otherText.get('text_no') }
            ],
            subject: otherText.get('subject')
        });
    }
});

jskom.Models.ReadQueueItem = Backbone.Model.extend({
    idAttribute: 'text_no',
    
    defaults: {
        text_no: null,
        text: null,
    },
    
    initialize: function(options) {
        this.set({ text: new jskom.Models.Text({ text_no: this.get('text_no') }) });
    }
}),

jskom.Collections.ReadQueue = Backbone.Collection.extend({
    model: jskom.Models.ReadQueueItem,
    
    initialize: function(models, options) {
        options || (options = { prefetchCount: 0 })
        this._prefetchCount = options.prefetchCount;
        
        this.on('add', function(model, collection, opts) {
            if (opts.index < this._prefetchCount) {
                console.log("readQueue:add - prefetching text: " + model.get('text_no'));
                model.get('text').deferredFetch();
            }
        }, this);
        this.on('remove', function(model, collection, opts) {
            if (opts.index < this._prefetchCount && this.length >= this._prefetchCount) {
                var text = this.at(this._prefetchCount - 1).get('text');
                console.log("readQueue:remove - prefetching text: " + text.get('text_no'));
                text.deferredFetch();
            }
        }, this);
    }
});

jskom.Models.UnreadConference = Backbone.Model.extend({
    idAttribute: 'conf_no',
    
    defaults: {
        conf_no: null,
        name: null,
        no_of_unread: null
    }
});

jskom.Collections.UnreadConferences = Backbone.Collection.extend({
    model: jskom.Models.UnreadConference,
    
    url: '/conferences/unread/',
    
    // Because httpkom doesn't return an array of models by default we need
    // to point Backbone.js at the correct property
    parse: function(resp, xhr) {
        return resp.confs;
    },
});


jskom.Models.LocalReadMarking = Backbone.Model.extend({
    idAttribute: 'text_no',
    
    defaults: {
        conf_no: null,
        local_text_no: null,
        text_no: null,
        unread: null,
    },
    
    url: function() {
        return '/conferences/' + encodeURIComponent(this.get('conf_no')) +
            '/texts/' + encodeURIComponent(this.get('local_text_no')) + '/read-marking';
    },
});

jskom.Models.GlobalReadMarking = Backbone.Model.extend({
    idAttribute: 'text_no',
    
    defaults: {
        text_no: null,
        unread: null,
    },
    
    url: function() {
        return '/texts/' + encodeURIComponent(this.get('text_no')) + '/read-marking';
    },
});

jskom.Collections.ReadMarkings = Backbone.Collection.extend({
    model: jskom.Models.LocalReadMarking,
    
    url: function() {
        return '/conferences/' + encodeURIComponent(this.conf_no) + '/read-markings/';
    },
    
    initialize: function(models, options) {
        this.conf_no = options.conf_no;
    },

    // Because httpkom doesn't return an array of models by default we need
    // to point Backbone.js at the correct property
    parse: function(resp, xhr) {
        return resp.rms;
    },
});
