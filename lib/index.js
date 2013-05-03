var http = require('http'),
    jade = require('jade'),
    fs = require('fs'),
    url = require('url'),
    formidable = require('formidable'),
    async = require('async'),
    Github = require('github'),
    github = new Github({ version: '3.0.0' }),
    repos = {},
    middleware = [],
    indexTemplate = fs.readFileSync('./views/index.jade', 'utf8');

var gitenforcer = module.exports = function (config) {
    if (!config) throw new Error('Must specify a valid configuration');
    if (!config.username) throw new Error('Must specify username');
    if (!config.password) throw new Error('Must specify password');
    if (!config.baseUrl) throw new Error('Must specify baseUrl');
    if (!(this instanceof gitenforcer)) return new gitenforcer(config);
    this.config = config;
    this.github = new Github({ version: '3.0.0' });
    this.github.authenticate({
        type: 'basic',
        username: this.config.username,
        password: this.config.password
    });
    this.pollRepos();
    if (config.pollInterval) setInterval(this.pollRepos.bind(this), config.pollInterval * 1000);
};

gitenforcer.prototype.use = function (func) {
    if (typeof func === 'function') {
        middleware.push(func);
    } else {
        throw new Error('Middleware does not appear to be a function');
    }
};

function sendCode(code, res) {
    var error = JSON.stringify({ error: http.STATUS_CODES[code] }),
        headers = {
            'Content-Type': 'application/json',
            'Content-Length': error.length
        };
    res.writeHead(code, headers);
    res.end(error);
}

gitenforcer.prototype.listen = function (port, hostname, callback) {
    var self = this;
    http.createServer(function (req, res) {
        var parsed = url.parse(req.url),
            match = parsed.pathname.match(/\/(\w+)\/?(\w+)?/),
            handled = false,
            parser,
            index,
            repo,
            action,
            id,
            payload;
        if (req.method === 'GET') {
            if (parsed.pathname === '/') {
                parser = jade.compile(indexTemplate);
                index = parser({ repos: repos });
                res.writeHead(200, {
                    'Content-Type': 'text/html',
                    'Content-Length': index.length
                });
                return res.end(index);
            }
        } else if (req.method === 'POST') {
            if (match) {
                repo = match[1];
                action = match[2];
                if (typeof action === 'undefined') {
                    return self.addHook(repo, res);
                } else if (action === 'delete') {
                    return self.removeHook(repo, res);
                } else if (action === 'callback') {
                    handled = true;
                    var form = new formidable.IncomingForm();
                    form.parse(req, function (err, fields, files) {
                        payload = JSON.parse(fields.payload);
                        id = payload.number || payload.issue.number;
                        self.checkStatus(repo, id, res);
                    });
                }
            }
        }
        if (!handled) sendCode(404, res);
    }).listen(port, hostname, undefined, callback);
};

gitenforcer.prototype.checkStatus = function (repo, id, res) {
    var self = this,
        user = this.config.username || this.config.organization;

    function runMiddleware(pull, comments) {
        async.forEach(middleware, function (func, cb) {
            func(pull, comments, function (failed) {
                cb(failed);
            }, self.github);
        }, function (err) {
            var state, description;
            if (err) {
                state = 'failure';
                description = err;
            } else {
                state = 'success';
                description = 'GitEnforcer: All tests passed';
            }
            self.github.statuses.create({
                user: user,
                repo: repo,
                sha: pull.head.sha,
                state: state,
                description: description
            }, function (err, data) {
                if (err) return sendCode(500, res);
                sendCode(200, res);
            });
        });
    }

    if (~Object.keys(repos).indexOf(repo)) {
        if (repos[repo].id) {
            self.github.issues.getComments({
                user: user,
                repo: repo,
                number: id,
                per_page: 100
            }, function (err, data) {
                if (err) return sendCode(500, res);
                self.github.pullRequests.get({
                    user: user,
                    repo: repo,
                    number: id
                }, function (err, rdata) {
                    runMiddleware(rdata, data);
                });
            });
        } else {
            sendCode(404, res);
        }
    } else {
        sendCode(404, res);
    }
};

gitenforcer.prototype.addHook = function (repo, res) {
    var self = this,
        user = this.config.username || this.config.organization,
        repoConfig = { url: this.config.baseUrl + '/' + repo + '/callback' };
    if (~Object.keys(repos).indexOf(repo)) {
        if (!repos[repo].id) {
            self.github.repos.createHook({
                user: user,
                repo: repo,
                name: 'web',
                config: repoConfig,
                events: ['issue_comment', 'pull_request']
            }, function (err, data) {
                if (err) return sendCode(500, res);
                repos[repo].id = data.id;
                sendCode(201, res);
            });
        } else {
            sendCode(304, res);
        }
    } else {
        sendCode(404, res);
    }
};

gitenforcer.prototype.removeHook = function (repo, res) {
    var self = this,
        user = this.config.username || this.config.organization;
    if (~Object.keys(repos).indexOf(repo)) {
        if (repos[repo].id) {
            self.github.repos.deleteHook({
                user: user,
                repo: repo,
                id: repos[repo].id
            }, function (err, data) {
                if (err) return sendCode(500, res);
                delete repos[repo].id;
                sendCode(200, res);
            });
        } else {
            sendCode(304, res);
        }
    } else {
        sendCode(404, res);
    }
};

gitenforcer.prototype.pollRepos = function () {
    var self = this,
        user = this.config.organization || this.config.username;

    function checkWatched(repo) {
        if (!repos.hasOwnProperty(repo)) repos[repo] = { name: repo };
        self.github.repos.getHooks({ user: user, repo: repo }, function (err, data) {
            if (err || data.length === 0) return;
            data.forEach(function (detail) {
                if (detail.name === 'web' && detail.config.url.match(self.config.baseUrl)) {
                    repos[repo].id = detail.id;
                }
            });
        });
    }

    function checkRepos(err, data) {
        if (err) return;
        var repos = data.map(function (item) {
            return item.name;
        });
        repos.forEach(function (repo) {
            checkWatched(repo);
        });
    }

    if (self.config.organization) {
        self.github.repos.getFromOrg({ org: self.config.organization, type: 'all' }, checkRepos);
    } else {
        self.github.repos.getFromUser({ user: self.config.username, type: 'all' }, checkRepos);
    }
};
