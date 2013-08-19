var Github = require('github');
var express = require('express');
var router = require('./router');

var gitenforcer = module.exports = function (options) {
    if (!(this instanceof gitenforcer)) return new gitenforcer(options);

    // validate the options
    if (typeof options !== 'object') throw new Error('Must include a configuration object');
    if (typeof options.token !== 'string') throw new Error('Must include a valid oauth token');
    if (typeof options.baseUrl !== 'string') throw new Error('Must include a valid baseUrl');

    // initialize the empty middleware array
    this.middleware = [];

    // save a copy for future reference
    this.options = options;

    // setup the github client
    this.github = new Github({ version: '3.0.0', debug: false });
    this.github.authenticate({ type: 'oauth', token: this.options.token });

    // setup the express app
    this.app = express();
    this.app.set('view engine', 'jade');
    this.app.use(express.logger());
    this.app.use(express.favicon());

    this.app.get('/', router.index(this));
    this.app.get('/:repo', router.repo(this));
    this.app.post('/github/callback', express.bodyParser(), router.callback(this));
    this.app.post('/enforce/:repo', router.enforce(this));
    this.app.post('/unenforce/:repo', router.unenforce(this));

    var self = this;
    router.getAllRepos(self, function () {
        self.app.listen(options.port || 1337);
    });
}

// helper to add middleware to the stack
gitenforcer.prototype.use = function _use(fun) {
    if (typeof fun !== 'function') throw new Error('Middleware does not appear to be a function');
    this.middleware.push(fun);
}
