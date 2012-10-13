GitEnforcer
-----------

GitEnforcer is a small bot that you would run on your own server to monitor github pull requests. It comes with a very basic interface to allow you to watch or unwatch your repos. Any time a pull request is created, updated, or commented on, all defined middleware are run. If any middleware fails, the pull request status is set to failed with the reason returned by that failing middleware. If they all pass, the merge button remains green.

Middleware
==========

Middleware are functions defined as

```javascript
function myMiddleware(pull_request, comments, next) { }
```

The pull_request object contains all the metadata github returns for a pull request as defined [here](http://developer.github.com/v3/pulls/#get-a-single-pull-request)

Comments is an array of comments on that pull request as defined [here](http://developer.github.com/v3/issues/comments/#list-comments-on-an-issue)

Next is the callback function you should run when your check is complete. If you return no parameter, GitEnforcer will continue execution on the next middleware. If you specify a paramater (as a string) then execution of middleware stops, and that string is set as the reason for failure on the pull request's status.

Usage
=====

For basic usage, see example.js
