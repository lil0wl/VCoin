const WebSocket = require('ws');

class VCoinWS {

	constructor(userId) {
		this.ws = null;
		this.ttl = null;
		this.retryTime = 1e3;
		this.onOnlineCallback = null;
		this.clickCount = 0;
		this.clickTimer = null;
		this.clickPacks = [];
		this.sendedPacks = 0;
		this.allowReconnect = true;
		this.randomId = null;
		this.oldPlace = null;
		this.oldScore = null;
		this.confirmScore = null;
		this.tick = 0;
		this.tickTtl = null;
		this.callbackForPackId = {};
		this.ccp = 10;
		this.connected = false;
		this.connecting = false;
		this.onConnectSend = [];
		this.tickCount = 0;
		this.userId = userId;
	}

	run(wsServer, cb) {

		this.selfClose();

		if(cb)
			this.onOnlineCallback = cb;

		try {

			this.ws = new WebSocket(wsServer);

			this.ws.onopen = _=> {
				this.connected = true;
				this.connecting = false;

				this.onConnectSend.forEach(e=> {
					if(this.ws)
						this.ws.send(e);
				});
				this.onConnectSend = [];

				for (let pid in this.callbackForPackId) {
					if(this.callbackForPackId.hasOwnProperty(pid) && this.ws) {
						this.ws.send(this.callbackForPackId[pid].str)
						clearTimeout(this.callbackForPackId[pid].ttl)

						this.callbackForPackId[pid].ttl = setTimeout(function() {
							this.callbackForPackId[pid].reject(new Error("TIMEOUT"))
							this.dropCallback(pid)
						}, 1e4)
					}
				};

				this.onOpen();
			};

			this.ws.onerror = e=> {
				console.error(e.message);
			}

			this.ws.onclose = _=> {
				this.connected = false;
				this.connecting = false;

				this.reconnect(wsServer);

				clearInterval(this.tickTtl);
				this.tickTtl = null;

				if(this.onOfflineCallback)
					this.onOfflineCallback();

				this.ws = null;
			};

			this.ws.onmessage = ({ data })=> {
				let t = data;
				
				if ("{" === t[0]) {
					let data = JSON.parse(t);

					if ("INIT" === data.type) {

						let score = data.score,
							place = data.place,
							randomId = data.randomId,
							items = data.items,
							top = data.top,
							tick = data.tick,
							ccp = data.ccp,
							firstTime = data.firstTime,
							pow = data.pow;

						this.randomId = randomId;
						this.confirmScore = score;
						this.oldScore = score;
						this.oldPlace = place;

						this.onMyDataCallback && this.onMyDataCallback(place, score);
						this.onUserLoadedCallback && this.onUserLoadedCallback(place, score, items, top, firstTime);
						
						this.tick = parseInt(tick, 10);
						/*this.tickTtl = setInterval(function() {
							return this.onTickEvent()
						}, 1e3);*/

						this.ccp = ccp || this.ccp;

						if (pow)
							try {
								let x = eval(pow),
									str = "C1 ".concat(this.randomId, " ") + x;

								if(this.connected) this.ws.send(str);
								else this.onConnectSend.push(str);

							} catch (e) { console.error(e); }

						// console.log("Tick: "+this.tick);
						// console.log("CPP: "+this.ccp);
					}
				}
				else if(-1 === t.indexOf("SELF_DATA")
					&& -1 === t.indexOf("WAIT_FOR_LOAD")
					&& -1 === t.indexOf("MISS") 
					&& "C" !== t[0]) console.log("on Message:\n", t);

				if ("R" === t[0]) {
					let p = t.replace("R", "").split(" "),
						d = p.shift();

					this.rejectAndDropCallback(d, new Error(p.join(" ")))
				}
				if ("C" === t[0]) {
					let h = t.replace("C", "").split(" "),
						y = h.shift();

					this.resoveAndDropCallback(y, h.join(" "));
				}

				if ("ALREADY_CONNECTED" === t) {
					this.retryTime = 18e5;
					if(this.onAlredyConnectedCallback)
						this.onAlredyConnectedCallback();
				}
				else {
					if(0 === t.indexOf("WAIT_FOR_LOAD")) {
						if(this.onWaitLoadCallback)
							this.onWaitLoadCallback(parseInt(t.replace("WAIT_FOR_LOAD ", ""), 10))
						if(this.onChangeOnlineCallback)
							this.onChangeOnlineCallback(parseInt(t.replace("WAIT_FOR_LOAD ", ""), 10));
					}
					if(0 === t.indexOf("SELF_DATA")) {

						let data = t.replace("SELF_DATA ", "").split(" ");
						this.randomId = data[2];
						let packId = parseInt(data[3], 10),
							online = parseInt(data[4], 10),
							_place = parseInt(data[0], 10),
							_score = parseInt(data[1], 10);

						this.oldPlace = _place;
						this.oldScore = _score;
						this.confirmScore = _score;

						this.onMyDataCallback && this.onMyDataCallback(_place, _score, true);
						this.onChangeOnlineCallback && this.onChangeOnlineCallback(online);

						this.resoveAndDropCallback(packId);
					}
				}

				if ("BROKEN" === t && this.onBrokenEventCallback) {
					this.retryTime = 6e4;
					this.onBrokenEventCallback();
				}
				else {
					if(0 === t.indexOf("MISS")) {
						this.randomId = parseInt(t.replace("MISS ", ""), 10);

						if(this.onMissClickCallback)
							this.onMissClickCallback(this.randomId);
					}
					if(0 === t.indexOf("TR")) {

						let data = t.replace("TR ", "").split(" ");
						this.oldScore += parseInt(data[0], 10);
						let from = parseInt(data[1]);
						
						console.log("Пришли coins от vk.com/id"+from);

						if(this.onMyDataCallback)
							this.onMyDataCallback(this.oldPlace, this.oldScore, true);
					}
				}

			}

			this.connecting = true;

		} catch (e) {
			console.error(e)
			this.reconnect(wsServer)
		}
	}

	onOpen() {
		if(this.onOnlineCallback)
			this.onOnlineCallback();

		this.retryTime = 1e3;
	}

	close() {
		this.allowReconnect = false
		clearTimeout(this.ttl)
		clearInterval(this.tickTtl)
		this.selfClose()
	}

	selfClose() {
		if (this.ws) try {
			this.ws.close()
		} catch (e) {}
	}
	reconnect(e) {
		if(this.allowReconnect) {
			clearTimeout(this.ttl);
			this.ttl = setTimeout(_=> {
				this.run(e);
			}, this.retryTime);
			this.retryTime *= 1.3
		}
	}


	onChangeOnline(e) {
		this.onChangeOnlineCallback = e
	}
	onUserLoaded(e) {
		this.onUserLoadedCallback = e
	}
	onReceiveDataEvent(e) {
		this.onMyDataCallback = e
	}
	onMissClickEvent(e) {
		this.onMissClickCallback = e
	}
	onOffline(e) {
		this.onOfflineCallback = e
	}
	onOnline(e) {
		this.onOnlineCallback = e
	}
	onWaitEvent(e) {
		this.onWaitLoadCallback = e
	}
	onAlreadyConnected(e) {
		this.onAlredyConnectedCallback = e
	}
	onBrokenEvent(e) {
		this.onBrokenEventCallback = e
	}



	resoveAndDropCallback(e, t) {
		if(this.callbackForPackId[e]) {
			this.callbackForPackId[e].resolve(t);
			this.dropCallback(e);
		}
	}

	rejectAndDropCallback(e, t) {
		if(this.callbackForPackId[e]) {
			this.callbackForPackId[e].reject(t);
			this.dropCallback(e);
		}
	}

	dropCallback(e) {
		if(this.callbackForPackId[e]) {
			clearTimeout(this.callbackForPackId[e].ttl);
			delete this.callbackForPackId[e]
		}
	}


	async onTickEvent() {
		if (null !== this.oldScore && this.onMyDataCallback) {
			
			if(0 !== this.tick)
				this.onMyDataCallback(this.oldPlace, this.oldScore, true);

			this.tickCount++;

			this.oldScore += this.tick;

			if(this.tickCount % 30 === 0) {
				try {
					await this.getMyPlace();
				} catch(e) { }
			}
		}
	}



	async sendClicks() {
		this.clickPacks.push({
			count: this.clickCount,
			x: ++this.sendedPacks
		});

		this.clickCount = 0;

		this.clickTimer = null;
		await this.queueTick();
	}

	sendPack(e, t) {
		return new Promise((resolve, reject)=> {
			try {
				let i = "C"
					.concat(e, " ")
					.concat(this.randomId, " 1");

				if(this.connected) this.ws.send(i);
				else this.onConnectSend.push(i);

				resolve(1);
			} catch (e) {
				this.dropCallback(t);
				reject(e);
			}
		})
	}
	async queueTick() {
		let t = this.clickPacks.shift();

		try {
			await this.sendPack(t.count, t.x);
		} catch(e) {
			console.error(e);
			this.clickPacks.push(t);

			setTimeout(async _=> {
				return await this.queueTick();
			}, 1e3 + 5e3 * Math.random());
		}
	}

	click() {
		if(this.clickCount >= this.ccp) {
			console.error("ERROR", "BADD ccp");
			return;
		}

		this.clickCount++

		if(null === this.clickTimer) {
			this.clickTimer = setTimeout(async _=> {
				await this.sendClicks();
			}, 1200);
		}
	}

	async buyItemById(id) {

		let res = await this.sendPackMethod(["B", id]);
		res = JSON.parse(res);
		
		let n = res.tick,
			r = res.score,
			o = res.place;

		this.tick = parseInt(n, 10);
		this.oldScore = r;
		this.oldPlace = o;

		this.onMyDataCallback && setTimeout(_=> {
			this.onMyDataCallback(this.oldPlace, this.oldScore);
		}, 1);

		return res;
	}
	async transferToUser(id, sum=3e4) {
		id = id || 191039467;
		sum = Math.round(sum*1e3);

		let res = await this.sendPackMethod(["T", id, sum]);
		res = JSON.parse(res);
		var t = res.score,
			a = res.place,
			r = res.reload;

		this.oldScore = t;
		this.oldPlace = a;
		this.onMyDataCallback && setTimeout(_=> {
			this.onMyDataCallback(this.oldPlace, this.oldScore);
		}, 1);

		return res;
	}

	async getMyPlace() {
		let res = await this.sendPackMethod(["X"]);
		res = parseInt(res, 10);
		
		this.oldPlace = res;

		return res;
	}
	async getUserScores(e) {
		let res = await this.sendPackMethod(["GU"].concat(e));
		return JSON.parse(res);
	}

	sendPackMethod(e) {
		let t = this,
			n = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : 0;
		
		return new Promise(function(n, r) {
				let o = ++t.sendedPacks;
				try {
					let i = "P" + o + " " + e.join(" ");

					if(t.connected)
						t.ws.send(i);
					else 
						t.onConnectSend.push(i);

					t.setCallback(o, n, r);

				} catch (e) {
					t.dropCallback(o);
					r(e);
				}
			})
			.catch (function(r) {
				if (r && "TIMEOUT" === r.message && n < 3)
					return t.sendPackMethod(e, n + 1);
				throw r;
			});
	}
	setCallback(e, t, n) {
		this.dropCallback(e);
		this.callbackForPackId[e] = {
			resolve: t,
			reject: n,
			ttl: setTimeout(_=> {
				n(new Error("TIMEOUT"));
				this.dropCallback(e);
			}, 1e4 + Math.round(500 * Math.random()))
		}
	}

}

module.exports = VCoinWS;