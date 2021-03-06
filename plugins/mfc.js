const mfc     = require("MFCAuto");
const {Site}  = require("../core/site");
const _       = require("underscore");
const colors  = require("colors/safe");

class Mfc extends Site {
    constructor(name, tui) {
        super(name, tui);
        if (typeof this.siteConfig.mfcautolog !== "undefined" && this.siteConfig.mfcautolog === false) {
            mfc.setLogLevel(0);
        }
        this.mfcGuest = new mfc.Client("guest", "guest", {
            useWebSockets: this.siteConfig.mfcWebSocket,
            modernLogin:   this.siteConfig.modernLogin,
            camYou:        false
        });

        this.dirty = false;
    }

    async connect() {
        try {
            await this.mfcGuest.connectAndWaitForModels();
        } catch (err) {
            this.errMsg(err.toString());
        }
    }

    async disconnect() {
        try {
            await this.mfcGuest.disconnect();
        } catch (err) {
            this.errMsg(err.toString());
        }
    }

    async updateList(nm, add, isTemp) {
        // Fetch the UID. The streamer does not have to be online for this.
        if (this.mfcGuest.state === mfc.ClientState.ACTIVE) {
            try {
                const streamer = await this.mfcGuest.queryUser(nm);
                if (streamer) {
                    if (super.updateList(streamer, add, isTemp)) {
                        this.dirty = true;
                    }
                } else {
                    this.errMsg(colors.name(nm) + " does not exist on this site");
                }
                return true;
            } catch (err) {
                this.errMsg(err.toString());
            }
        }
        return false;
    }

    async updateStreamers(list, add) {
        this.dirty = false;
        const queries = list.map((x) => this.updateList(x, add, false));
        try {
            await Promise.all(queries);
        } catch (err) {
            this.errMsg(err.toString());
        }
        return this.dirty;
    }

    async checkStreamerState(uid) {
        if (this.mfcGuest.state !== mfc.ClientState.ACTIVE) {
            return false;
        }

        let model;
        try {
            model = await this.mfcGuest.queryUser(uid);
        } catch (err) {
            this.errMsg(err.toString());
            return false;
        }

        if (typeof model === "undefined" || typeof model.uid === "undefined") {
            return false;
        }

        let isStreaming = 0;
        let msg = colors.name(model.nm);

        if (!this.streamerList.has(uid)) {
            this.streamerList.set(uid, {uid: uid, nm: model.nm, site: this.padName, state: "Offline", filename: "", captureProcess: null, postProcess: 0});
        }

        const streamer = this.streamerList.get(uid);
        const prevState = streamer.state;

        const bestSession = mfc.Model.getModel(model.uid).bestSession;

        if (bestSession.vs === mfc.STATE.FreeChat) {
            streamer.state = "Public Chat";
            msg += " is in public chat!";
            isStreaming = 1;
        } else if (bestSession.vs === mfc.STATE.GroupShow) {
            streamer.state = "Group Show";
            msg += " is in a group show";
        } else if (bestSession.vs === mfc.STATE.Private) {
            if (bestSession.truepvt === 1) {
                streamer.state = "True Private";
                msg += " is in a true private show.";
            } else {
                streamer.state = "Private";
                msg += " is in a private show.";
            }
        } else if (bestSession.vs === mfc.STATE.Away) {
            streamer.state = "Away";
            msg += " is away.";
        } else if (bestSession.vs === mfc.STATE.Online) {
            streamer.state = "Away";
            // Check the last character but avoid color codes
            msg += msg.charAt(msg.length - 6) === "s" ? colors.name("'") : colors.name("'s");
            msg += " stream is off.";
        } else if (bestSession.vs === mfc.STATE.Offline) {
            streamer.state = "Offline";
            msg += " has logged off.";
        }

        super.checkStreamerState(streamer, msg, isStreaming, prevState);

        if (isStreaming) {
            this.startCapture(this.setupCapture(streamer));
        }

        return true;
    }

    async getStreamers() {
        if (!super.getStreamers()) {
            return;
        }

        const queries = [];

        for (let i = 0; i < this.siteConfig.streamers.length; i++) {
            queries.push(this.checkStreamerState(this.siteConfig.streamers[i]));
        }

        // Only add a streamer from temp list if they are not
        // in the primary list.  Prevents duplicate recording.
        for (let i = 0; i < this.tempList.length; i++) {
            if (!_.contains(this.siteConfig.streamers, this.tempList[i])) {
                queries.push(this.checkStreamerState(this.tempList[i]));
            }
        }

        try {
            await Promise.all(queries);
        } catch (err) {
            this.errMsg(err.toString());
        }
    }

    setupCapture(model) {
        if (!super.setupCapture(model.uid)) {
            return {spawnArgs: "", filename: "", streamer: ""};
        }

        const filename = this.getFileName(model.nm);
        const mod = mfc.Model.getModel(model.uid);
        if (mod.camserv < 840) {
            this.msg(colors.name(model.nm) + " does not have a mobile feed and can not be captured");
            return {spawnArgs: "", filename: "", streamer: ""};
        }

        let url = this.mfcGuest.getHlsUrl(mod);
        if (this.tui.config.recording.streamlink) {
            url = "hlssession://" + url;
        }

        // Checking if this is 16:9 stream via base64 key-characters in url
        const params = [];
        if (url.indexOf("==") === -1) {
            // MFC is upscaling streams to 1280x960 wasting bandwidth
            // These mappings work around it to select the true resolution
            params.push("-map");
            params.push("0:1");
            params.push("-map");
            params.push("0:2");
        }

        const spawnArgs = this.getCaptureArguments(url, filename, {params: params});

        return {spawnArgs: spawnArgs, filename: filename, streamer: model};
    }
}

exports.Plugin = Mfc;

