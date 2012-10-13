var gitenforcer = require('./lib/index'),
    app = gitenforcer({ username: 'YOURUSER', password: 'YOURPASSWORD', baseUrl: 'YOURBASEURL' });

// middleware to check for occurrences of the word "bacon" in comments
function checkVotes(pull_request, comments, next) {
    var count = 0;
    // iterate over comments and check the body contents
    comments.forEach(function (comment) {
        if (comment.body.match('bacon')) {
            count += 1;
        }
    });
    // found less than 5 occurrences, so let's set the status as failed by returning a parameter
    if (count < 5) return next('bacon was only found ' + count + ' times');
    // everything's ok, return no parameter and the next middleware will run
    next();
}

// use the middleware
app.use(checkVotes);
// listen on a port
app.listen(3000);
