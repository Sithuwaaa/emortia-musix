/* Publishing a file back to the repository the site is served from.

   These tools are static pages on GitHub Pages: there is no server, so an
   uploaded workbook has nowhere to go but the browser that uploaded it. That is
   why two devices could show different numbers. Writing the file back to the
   repository through the GitHub API gives every device one copy to read.

   The token is a fine-grained personal access token, kept in this browser's
   localStorage and sent only to api.github.com. It is never written into the
   repository and never leaves the machine it was entered on. Only the owner
   needs one — everyone else just reads the published file over plain HTTPS. */
(function(){
  var TOKEN_KEY = 'emortia_gh_token';
  var CFG_KEY   = 'emortia_gh_repo';      // optional "owner/repo@branch" override

  function cfg(){
    var raw = '';
    try { raw = localStorage.getItem(CFG_KEY) || ''; } catch(e){}
    if (raw){
      var m = raw.match(/^([^\/]+)\/([^@]+)(?:@(.+))?$/);
      if (m) return { owner:m[1], repo:m[2], branch:m[3] || 'main' };
    }
    // user.github.io/repo/... — the project site's own address names both
    var host = (location.hostname || '').toLowerCase();
    var gh = host.match(/^([a-z0-9-]+)\.github\.io$/);
    if (!gh) return null;
    var seg = (location.pathname || '').split('/').filter(Boolean);
    if (!seg.length) return null;
    return { owner: gh[1], repo: seg[0], branch: 'main' };
  }

  function token(){ try { return localStorage.getItem(TOKEN_KEY) || ''; } catch(e){ return ''; } }
  function ready(){ return !!(cfg() && token()); }

  function api(path, opts){
    var c = cfg();
    if (!c) return Promise.reject(new Error('This page is not being served from a GitHub Pages project site, so there is no repository to publish to.'));
    opts = opts || {};
    opts.headers = Object.assign({
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }, opts.headers || {});
    var t = token();
    if (t) opts.headers['Authorization'] = 'Bearer ' + t;
    return fetch('https://api.github.com/repos/' + c.owner + '/' + c.repo + path, opts)
      .then(function(r){
        return r.text().then(function(body){
          var j = null; try { j = body ? JSON.parse(body) : null; } catch(e){}
          if (!r.ok){
            var msg = (j && j.message) || ('HTTP ' + r.status);
            if (r.status === 401) msg = 'GitHub rejected the token. It may have expired, or been revoked.';
            if (r.status === 403) msg = 'GitHub refused the write. The token needs Contents: Read and write on this repository.';
            if (r.status === 404) msg = 'Not found. Check the token can see ' + c.owner + '/' + c.repo + '.';
            var err = new Error(msg); err.status = r.status; throw err;
          }
          return j;
        });
      });
  }

  function b64(buf){
    var bytes = new Uint8Array(buf), out = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH)
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(out);
  }

  /* Write a file, creating it if it is not there yet. GitHub needs the blob sha
     of what is being replaced, so read that first. */
  function putFile(path, buf, message){
    var enc = path.split('/').map(encodeURIComponent).join('/');
    var c = cfg();
    return api('/contents/' + enc + '?ref=' + encodeURIComponent(c.branch))
      .then(function(meta){ return meta && meta.sha; })
      .catch(function(e){ if (e.status === 404) return null; throw e; })
      .then(function(sha){
        var body = { message: message || ('Update ' + path), content: b64(buf), branch: c.branch };
        if (sha) body.sha = sha;
        return api('/contents/' + enc, { method:'PUT', body: JSON.stringify(body) });
      });
  }

  /* Check a token before storing it, so a bad one fails at the point of entry
     rather than in the middle of an upload. */
  function connect(){
    var c = cfg();
    if (!c) return Promise.reject(new Error('Not on a GitHub Pages project site — publishing is only available on the live site.'));
    var t = window.prompt(
      'Paste a GitHub fine-grained personal access token for ' + c.owner + '/' + c.repo + '.\n\n' +
      'It needs one permission: Repository permissions → Contents → Read and write.\n' +
      'Give it an expiry date. It is stored in this browser only and is never put in the repository.\n\n' +
      'Anyone who can use this browser profile can read it, so do not do this on a shared machine.');
    if (!t) return Promise.resolve(false);
    t = t.trim();
    try { localStorage.setItem(TOKEN_KEY, t); } catch(e){}
    return api('/contents/?ref=' + encodeURIComponent(c.branch))
      .then(function(){ return true; })
      .catch(function(e){ try { localStorage.removeItem(TOKEN_KEY); } catch(x){} throw e; });
  }

  function disconnect(){ try { localStorage.removeItem(TOKEN_KEY); } catch(e){} }

  window.Publish = {
    config: cfg, ready: ready, connect: connect, disconnect: disconnect,
    putFile: putFile, hasToken: function(){ return !!token(); }
  };
})();
