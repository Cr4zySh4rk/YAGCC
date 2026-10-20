import { VID, PIDS, VREQ, CFG_SIZE, parseConfig, serializeConfig, parseInfo, parseStatus, parseBtLog, parseBtLogFlash } from './protocol.js?v=dev';

const IFACE = 1;   // vendor config interface

export const webusbSupported = () => 'usb' in navigator;

export class YaccDevice extends EventTarget {
  constructor(dev) { super(); this.dev = dev; this.info = null; this.polling = false; this.last = null; }

  static filters() { return PIDS.map((productId) => ({ vendorId: VID, productId })); }

  static async pick() {
    const dev = await navigator.usb.requestDevice({ filters: YaccDevice.filters() });
    return new YaccDevice(dev);
  }

  static async authorised() {
    const list = await navigator.usb.getDevices();
    return list.filter((d) => d.vendorId === VID && PIDS.includes(d.productId)).map((d) => new YaccDevice(d));
  }

  async open() {
    const d = this.dev;
    await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);
    await d.claimInterface(IFACE);
    this.info = await this.getInfo();
    return this.info;
  }

  async close() {
    this.polling = false;
    try { await this.dev.close(); } catch { /* already gone */ }
  }

  async _in(request, length) {
    const r = await this.dev.controlTransferIn(
      { requestType: 'vendor', recipient: 'interface', request, value: 0, index: IFACE }, length);
    if (r.status !== 'ok') throw new Error(`Control IN 0x${request.toString(16)} ${r.status}`);
    return r.data;
  }

  async _out(request, value = 0, data) {
    const setup = { requestType: 'vendor', recipient: 'interface', request, value, index: IFACE };
    const r = data ? await this.dev.controlTransferOut(setup, data) : await this.dev.controlTransferOut(setup);
    if (r.status !== 'ok') throw new Error(`Control OUT 0x${request.toString(16)} ${r.status}`);
  }

  async getInfo() { return parseInfo(await this._in(VREQ.INFO, 16)); }
  async getStatus() { return parseStatus(await this._in(VREQ.STATUS, 64)); }
  async getBtLog() { return parseBtLog(await this._in(VREQ.BTLOG, 384)); }
  // test firmware only (throws on normal builds, which stall the request)
  async getBtLogFlash() { return parseBtLogFlash(await this._in(VREQ.BTLOGFL, 16384)); }
  async clearBtLogFlash() { await this._out(VREQ.BTLOGFL); }
  async getConfig() { return parseConfig(await this._in(VREQ.GETCFG, CFG_SIZE)); }
  async setConfig(cfg) { await this._out(VREQ.SETCFG, 0, serializeConfig(cfg)); }
  async save() { await this._out(VREQ.SAVE); }
  async defaults() { await this._out(VREQ.DEFAULTS); }
  async rumbleTest(ms = 400) { await this._out(VREQ.RUMBLE, ms); }
  async ledTest(i) { await this._out(VREQ.LEDTEST, i < 0 ? 0xffff : i); }
  async reboot(bootsel = false) { await this._out(VREQ.REBOOT, bootsel ? 1 : 0); }

  // Continuous status polling; dispatches 'status' events and 'lost' if the device vanishes
  startPolling() {
    if (this.polling) return;
    this.polling = true;
    (async () => {
      let fails = 0;
      while (this.polling) {
        try {
          const s = await this.getStatus();
          fails = 0;
          this.last = s;
          this.dispatchEvent(new CustomEvent('status', { detail: s }));
        } catch (e) {
          if (++fails > 5) { this.polling = false; this.dispatchEvent(new Event('lost')); break; }
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    })();
  }
  stopPolling() { this.polling = false; }
}
