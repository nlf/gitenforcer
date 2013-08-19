exports.index = function _index(context) {
    return function _index_route(req, res, next) {
        getAllRepos(context, function () {
            res.locals.repos = context.repos;
            res.render('index');
        });
    };
};

exports.repo = function _repo(context) {
    return function _repo_route(req, res, next) {
        var repo = context.repos.filter(function (thisrepo) {
            return thisrepo.name === req.params.repo;
        })[0];

        getHook(context, req.params.repo, function (err, id) {
            repo.enforcer = id;
            res.locals.repo = repo;
            res.render('repo');
        });
    };
};

exports.callback = function _callback(context) {
    return function _callback_route(req, res, next) {
        var user = req.body.repository.owner.login;
        var repo = req.body.repository.name;
        var issue;
        var pr;

        // we have a comment
        if (req.body.comment) {
            issue = req.body.issue.number;
            if (!req.body.issue.pull_request) return;
        } else if (req.body.pull_request) {
            // we have a new pull request
            issue = req.body.pull_request.number;
            pr = req.body.pull_request;
        }

        context.github.issues.getComments({ user: user, repo: repo, number: issue, per_page: 100 }, function (err, comments) {
            context.github.pullRequests.get({ user: user, repo: repo, number: issue }, function (err, pr) {
                runMiddleware(context, comments, pr, req.body.repository);
            });
        });

        res.send(200);
    };
};

exports.enforce = function _enforce(context) {
    return function _enforce_route(req, res, next) {
        var owner = context.options.org || context.options.user;

        context.github.repos.createHook({ user: owner, repo: req.params.repo, name: 'web', config: { content_type: 'json', url: context.options.baseUrl + '/github/callback' }, events: ['pull_request', 'issue_comment'] }, function (err, result) {
            res.redirect('/' + req.params.repo);
        });
    };
};

exports.unenforce = function _unenforce(context) {
    return function _unenforce_route(req, res, next) {
        var owner = context.options.org || context.options.user;

        getHook(context, req.params.repo, function (err, id) {
            if (!id) res.send(200, { result: 'ok' });
            context.github.repos.deleteHook({ user: owner, repo: req.params.repo, id: id }, function (err, reply) {
                res.redirect('/' + req.params.repo);
            });
        });
    };
};

// fetch a list of *all* available repos, since we can only fetch up to 100 at a time
var getAllRepos = exports.getAllRepos = function (context, callback) {
    context.repos = [];

    var opts = { sort: 'updated', direction: 'desc', per_page: 100 };
    var getRepos;

    // add more options
    if (context.options.org) {
        opts.org = context.options.org;
        getRepos = context.github.repos.getFromOrg;
    } else if (context.options.user) {
        opts.user = context.options.user;
        getRepos = context.github.repos.getFromUser;
    }

    function _fetch() {
        getRepos(opts, function (err, data) {
            context.repos = context.repos.concat(data);

            // no link metadata means no other pages, so we're done
            if (!data.meta.link) {
                // orgs don't have sorting, so we just reverse the list
                if (opts.org) context.repos.reverse();
                return callback();
            }

            // split the link metadata on commas, each is a different page reference
            var links = data.meta.link.split(',');
            var link;

            // find the "next" page
            links.forEach(function (thislink) {
                if (thislink.match('rel="next"')) link = thislink;
            });

            // if there was no "next" page, we're done
            if (!link) {
                if (opts.org) context.repos.reverse();
                return callback();
            }

            // parse out the page number, and call ourselves for more repos
            opts.page = /\&page=([\d]+)\>/.exec(link)[1];
            _fetch();
        });
    }

    // start the recursive function
    _fetch();
}

// check each repo, and add an "enforced" property to them if they already have a hook enabled
// this function is *slow*
function getHook(context, repo, callback) {
    var result;
    var owner = context.options.org || context.options.user;

    // check for hooks
    context.github.repos.getHooks({ user: owner, repo: repo }, function (err, hooks) {
        // we have some hooks, so search them to see if they're our app
        if (hooks && hooks.length) {
            hooks.forEach(function (hook) {
                if (hook.name === 'web' && hook.config.url.match(context.options.baseUrl)) {
                    result = hook.id;
                }
            });
        }
        callback(null, result);
    });
}

function runMiddleware(context, comments, pr, repo) {
    var functions = context.middleware.slice();
    var sha = pr.head.sha;
    var owner = repo.owner.login;
    var repo = repo.name;
    var func;

    function _setStatus(err) {
        var status;
        var description = 'GitEnforcer: ';

        if (err) {
            status = 'failure';
            description += err;
        } else {
            status = 'success';
            description += 'All tests passed';
        }

        context.github.statuses.create({ user: owner, repo: repo, sha: sha, state: status, description: description }, function (err, reply) {
        });
    }

    function _run() {
        if (!functions.length) return _setStatus();

        func = functions.shift();

        func(pr, comments, function (err) {
            if (err) return _setStatus(err);
            _run();
        }, context.github);
    }

    _run();
}
