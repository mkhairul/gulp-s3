'use strict';

var es = require('event-stream');
var knox = require('knox');
var gutil = require('gulp-util');
var mime = require('mime');
var fs = require('fs');
mime.default_type = 'text/plain';

module.exports = function (aws, options) {
  options = options || {};

  if (!options.delay) { options.delay = 0; }

  var client = knox.createClient(aws);
  var waitTime = 0;
  var regexGzip = /\.([a-z]{2,})\.gz$/i;
  var regexGeneral = /\.([a-z]{2,})$/i;

  return es.mapSync(function (file) {

      // Verify this is a file
      if (!file.isBuffer()) { return file; }

      var uploadPath = file.path.replace(file.base, options.uploadPath || '');
      uploadPath = uploadPath.replace(new RegExp('\\\\', 'g'), '/');
      var headers = { 'x-amz-acl': 'public-read' };
      if (options.headers) {
          for (var key in options.headers) {
              headers[key] = options.headers[key];
          }
      }

      if (regexGzip.test(file.path)) {
          // Set proper encoding for gzipped files, remove .gz suffix
          headers['Content-Encoding'] = 'gzip';
          uploadPath = uploadPath.substring(0, uploadPath.length - 3);
      } else if (options.gzippedOnly) {
          // Ignore non-gzipped files
          return file;
      }

      // Set content type based of file extension
      if (!headers['Content-Type'] && regexGeneral.test(uploadPath)) {
        headers['Content-Type'] = mime.lookup(uploadPath);
        if (options.encoding) {
          headers['Content-Type'] += '; charset=' + options.encoding;
        }
      }

      headers['Content-Length'] = file.stat.size;
			var log_file = fs.createWriteStream(__dirname + '/debug.log', {flags : 'a'});
			var log = '';
			var retry = 0;

      var uploadFile = function(){
				client.putBuffer(file.contents, uploadPath, headers, function(err, res) {
					if (err || res.statusCode !== 200) {
							gutil.log(gutil.colors.red('[FAILED] ' + (err || res.statusCode), file.path + " -> " + uploadPath));
							log += (new Date().toISOString()) + '[FAILED] ' + file.path + '\n';
							log_file.write(log);
							if (retry === 0) {
								retry = 1;
								file.retry = 1;
								gutil.log(gutil.colors.yellow('Retrying..'));
								uploadFile();
							} else {
								if(retry > 5){
									log += (new Date().toISOString()) + '[ERROR] Too much retry ' + file.path + '\n';
									log_file.write(log);
								}else{
									retry += 1;
									file.retry += 1;
									uploadFile();
								}
							}
						} else {
							if (file.retry > 0 || retry > 0) {
								gutil.log(gutil.colors.blue('[SUCCESS]', file.path + " -> " + uploadPath));
								log += (new Date().toISOString()) + '[SUCCESS] ' + file.path + '\n';
								log_file.write(log);
							}	else {
								gutil.log(gutil.colors.green('[SUCCESS]', file.path + " -> " + uploadPath));
							}
							res.resume();
						}
				});
				if(log){
					//log_file.write(log);
				}
			}
			uploadFile();

      return file;
  });
};
