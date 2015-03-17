/*
 * Copyright 2015 Samuel Mansour <nuvola-app-mixcloud@yay.ovh>
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met: 
 * 
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer. 
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution. 
 * 
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
"use strict";

var nuvola = (function(Nuvola) {

  // media player component
  var player = Nuvola.$object(Nuvola.MediaPlayer);

  // aliases
  var PlaybackState = Nuvola.PlaybackState;
  var PlayerAction = Nuvola.PlayerAction;

  // create new WebApp prototype
  var WebApp = Nuvola.$WebApp();

  // Service store
  var Mixcloud = {
    "nodes": {},
    "scopes": {},
    "cloudcast": {
      "next": null,
      "prev": null
    },
    "html": {
      "wrapper": ["div", {
        "style": "display:none"
      }],
      "playAll": ["span", {
        "m-play-all-button": ""
      }]
    }
  };

  // initialization
  WebApp._onInitWebWorker = function(emitter) {
    Nuvola.WebApp._onInitWebWorker.call(this, emitter);

    var state = document.readyState;
    if (state === "interactive" || state === "complete") {
      this._onPageReady();
    } else {
      document.addEventListener("DOMContentLoaded", this._onPageReady.bind(this));
    }
  };

  // page is ready for magic
  WebApp._onPageReady = function() {
    // connect handler for signal ActionActivated
    Nuvola.actions.connect("ActionActivated", this);

    // build up custom nodes to communicate with the JS API
    this._injectCustomNodestoDom();

    // start update routine
    this.timeout = setInterval(this._setCallback.bind(this), 100);
  };

  // callback function for Mixcloud JS API
  WebApp._setCallback = function() {
    try {
      // Scopes are ready
      this._loadCustomScopes();

      // API loaded
      clearInterval(this.timeout);

      // Start update routine
      this.update();

      // load initial playback state
      this._watchPlaybackStatusAndUpdateNodes();
    } catch (e) {
      // JS API probably not ready yet
    }
  };

  // Extract data from the web page
  WebApp.update = function() {
    var track = {
      title: null,
      artist: null,
      album: null,
      artLocation: null
    }, state = PlaybackState.UNKNOWN;

    try {
      if (Mixcloud.scopes.global.webPlayer.playerOpen) {
        if (Mixcloud.scopes.PlayerQueueCtrl.player.buffering) {
          state = PlaybackState.UNKNOWN;
        } else if (Mixcloud.scopes.PlayerQueueCtrl.player.playing) {
          state = PlaybackState.PLAYING;
        } else {
          state = PlaybackState.PAUSED;
        }

        track.album = {};
        track.album.title = Mixcloud.scopes.PlayerQueueCtrl.player.currentCloudcast.title;
        track.album.artist = Mixcloud.scopes.PlayerQueueCtrl.player.currentCloudcast.owner;
        track.artLocation = Nuvola.format("https:{1}", Mixcloud.scopes.PlayerQueueCtrl.player.currentCloudcast.widgetImage);
        track.album = Nuvola.format("{1} by {2}", track.album.title, track.album.artist);

        if (Mixcloud.scopes.PlayerQueueCtrl.player.nowPlaying.currentDisplayTrack == null) {
          track.title = track.artist = null;
        } else {
          track.title = Mixcloud.scopes.PlayerQueueCtrl.player.nowPlaying.currentDisplayTrack.title;
          track.artist = Mixcloud.scopes.PlayerQueueCtrl.player.nowPlaying.currentDisplayTrack.artist;
        }
      } else {
        state = PlaybackState.PAUSED;
      }
    } catch (e) {
      // gracefull fallback withdefault settings@jokeyrhyme
    }

    player.setTrack(track);
    player.setPlaybackState(state);
    player.setCanPlay(state === PlaybackState.PAUSED);
    player.setCanPause(state === PlaybackState.PLAYING);

    player.setCanGoNext(Mixcloud.cloudcast.next !== null);
    player.setCanGoPrev(Mixcloud.cloudcast.prev !== null);

    // Schedule the next update
    setTimeout(this.update.bind(this), 500);
  };

  // Handler of playback actions
  WebApp._onActionActivated = function(emitter, name, param) {
    var index;
    try {
      switch (name) {
      case PlayerAction.TOGGLE_PLAY:
      case PlayerAction.PLAY:
        if (Mixcloud.scopes.global.webPlayer.playerOpen === false) {
          Nuvola.clickOnElement(Mixcloud.nodes.playAll);
        } else {
          Mixcloud.scopes.PlayerQueueCtrl.player.togglePlayClick();
        }
        break;
      case PlayerAction.STOP:
      case PlayerAction.PAUSE:
        Mixcloud.scopes.PlayerQueueCtrl.player.togglePlayClick();
        break;
      case PlayerAction.NEXT_SONG:
        if (Mixcloud.cloudcast.next) {
          Mixcloud.scopes.PlayerQueueCtrl.playerQueue.playFromQueue(Mixcloud.cloudcast.next);
        } else {
          Mixcloud.scopes.PlayerQueueCtrl.playerQueue.playUpNext();
        }
        break;
      case PlayerAction.PREV_SONG:
        Mixcloud.scopes.PlayerQueueCtrl.playerQueue.playFromQueue(Mixcloud.cloudcast.prev);
        break;
      }
    } catch (e) {
      console.log(e);
    }
  };

  // build up custom scopes
  WebApp._loadCustomScopes = function() {
    Mixcloud.scopes.global = $(document.body).scope();
    Mixcloud.scopes.PlayerQueueCtrl = $(document.querySelector('.ng-scope[ng-controller="PlayerQueueCtrl"]')).scope();
  }

  // current track playback detection by watching buffer
  WebApp._watchPlaybackStatusAndUpdateNodes = function() {
    try {
      // watch playback queue
      Mixcloud.scopes.PlayerQueueCtrl.$watch(function($scope) {
        return JSON.stringify($scope.playerQueue.cloudcastQueue);
      }, function(cloudcastQueue, oldValue, scope) {
        console.info("playback queue changed!");
        WebApp._updatePlaybackStatusCallback();
      });

      // watch suggested tracks
      Mixcloud.scopes.PlayerQueueCtrl.$watch(function($scope) {
        return Mixcloud.scopes.PlayerQueueCtrl.playerQueue.upNext;
      }, function(upNext) {
        if (upNext !== null && upNext.hasOwnProperty("nextCloudcast")) {
          console.info("suggested track detected!");
          Mixcloud.cloudcast.next = upNext.nextCloudcast;
          console.log("sibling", Mixcloud.cloudcast);
        }
      });

      // watch track change
      Mixcloud.scopes.PlayerQueueCtrl.$watch(function($scope) {
        return Mixcloud.scopes.PlayerQueueCtrl.player.currentCloudcast;
      }, function(track) {
        if (!WebApp._isEmpty(track)) {
          console.info('current track changed!');
          WebApp._updatePlaybackStatusCallback();
        }
      });

      // watch initial load of tracklist
      var unbindInitialLoad = Mixcloud.scopes.PlayerQueueCtrl.$watch(function($scope) {
        return Mixcloud.scopes.PlayerQueueCtrl.player.nowPlaying && Mixcloud.scopes.PlayerQueueCtrl.player.nowPlaying.hasOwnProperty("displayTracklist")
                ? Mixcloud.scopes.PlayerQueueCtrl.player.nowPlaying.displayTracklist.length : null;
      }, function(tracklistLength) {
        if (typeof tracklistLength === "number") {
          console.log("tracklist load finished!");
          WebApp._updatePlaybackStatusCallback();

          // we are done
          unbindInitialLoad();
        }
      });
    } catch (e) {
      // silent fallback
      console.log(e);
    }
  };

  // playback watch callback
  WebApp._updatePlaybackStatusCallback = function() {
    Mixcloud.nodes.curTrack = document.querySelector('.now-playing[m-player-queue-item]');
    Mixcloud.scopes.curTrack = Mixcloud.nodes.curTrack === null ? null : $(Mixcloud.nodes.curTrack).scope();

    if (Mixcloud.scopes.curTrack !== null) {
      this._getSiblings(Mixcloud.scopes.curTrack.$index);
    } else {
      console.log("current track could not be found");
    }
  };

  // extract next and previous track candidate
  WebApp._getSiblings = function(currentCloudcastIndex) {
    var siblings = {
      "next": null,
      "prev": null
    };

    try {
      siblings.next = currentCloudcastIndex < (Mixcloud.scopes.PlayerQueueCtrl.playerQueue.cloudcastQueue.length - 1)
              ? Mixcloud.scopes.PlayerQueueCtrl.playerQueue.cloudcastQueue[currentCloudcastIndex + 1] : null;
      siblings.prev = currentCloudcastIndex > 0 ? Mixcloud.scopes.PlayerQueueCtrl.playerQueue.cloudcastQueue[currentCloudcastIndex - 1] : null;
    } catch (e) {
      console.log(e);
    }

    Mixcloud.cloudcast = siblings;

    console.log("sibling", siblings);
  };

  // build custom elements and attach to DOM
  WebApp._injectCustomNodestoDom = function() {
    // build
    Mixcloud.nodes.wrapper = Nuvola.makeElement.apply(this, Mixcloud.html.wrapper);
    Mixcloud.nodes.playAll = Nuvola.makeElement.apply(this, Mixcloud.html.playAll);

    // attach to wrapper
    Mixcloud.nodes.wrapper.appendChild(Mixcloud.nodes.playAll);

    // attach to DOM
    document.body.appendChild(Mixcloud.nodes.wrapper);
  };

  // checks empty object
  WebApp._isEmpty = function(object) {
    for ( var key in object) {
      if (object.hasOwnProperty(key)) return false;
    }
    return true;
  };

  WebApp.start();

  return {
    debug: function() {
      if (console) console.log(Mixcloud);
    }
  };

})(this); // function(Nuvola)