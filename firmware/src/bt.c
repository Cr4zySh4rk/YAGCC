// Bluetooth on boards with the CYW43 radio (Pico W, Pico 2 W): Bluetooth LE HID (HID over GATT, BTstack).
// Other boards get no-op stubs and the web app disables the toggle.
//
// Over Bluetooth the guitar presents the same device as over USB in the running mode: the same HID report
// descriptor, the same report bytes and the same vendor / product ids (Device Information PnP ID). The XInput,
// original Xbox and Xbox One modes are not HID over USB, so they use the generic gamepad, as their USB
// descriptor callback does. Every mode has its own Bluetooth address and name ("YAGCC PS3 GH", ...), so a host
// sees each mode as its own device and never mixes up their report layouts.
//
// Pairing works like PS + Create on a PlayStation controller: hold Star power while plugging in or switching on
// (or Star power + Plus for 5 s while running) and the guitar forgets the hosts paired with the mode it starts in
// and becomes discoverable. The other modes keep their pairings. A new mode needs no Star power: the guitar
// always accepts pairing.
// Pairing uses LE Secure Connections with the keys stored in flash, like BTstack's HID demos. Each mode has its
// own bond list (the bond database is given a mode-specific tag range in the TLV store), so a host paired with
// several modes keeps a working key for each of them.
#include "bt.h"

#ifndef YACC_HAS_BT

bool bt_supported(void) { return false; }
void bt_init(bool enabled, bool pair, bool open_window) { (void)enabled; (void)pair; (void)open_window; }
void bt_task(void) {}
void bt_start_pairing(void) {}
uint8_t bt_state(void) { return BT_STATE_OFF; }
bool bt_running(void) { return false; }
void bt_send_report(const uint8_t *r, uint16_t len) { (void)r; (void)len; }
void bt_set_usb_active(bool active) { (void)active; }
int bt_vbus(void) { return -1; }
uint16_t bt_log_read(uint8_t *out, uint16_t max) { (void)out; (void)max; return 0; }
const uint8_t *bt_log_flash(uint16_t *len) { *len = 0; return 0; }
void bt_log_flash_clear(void) {}

#else

#include <string.h>
#include <stdio.h>
#include "pico/stdlib.h"
#include "pico/cyw43_arch.h"
#include "pico/unique_id.h"
#include "btstack.h"
#include "ble/gatt-service/device_information_service_server.h"
#include "ble/gatt-service/hids_device.h"
#include "yagcc.h"                       // GATT database generated from yagcc.gatt
#include "btstack_tlv.h"
#include "ble/le_device_db_tlv.h"
#include "config.h"
#include "rgb.h"

// from usb_common.h / usb_descriptors.c (that header pulls in TinyUSB, whose HID types clash with BTstack's)
extern uint8_t g_usb_mode;
const uint8_t *usb_hid_report_desc(uint16_t *len);
void usb_mode_ids(uint16_t *vid, uint16_t *pid, uint16_t *version);

#define PAIRING_TIMEOUT_MS 120000u       // discoverable for two minutes, like a game controller
#define WINDOW_TIMEOUT_MS   60000u       // after a mode change: let an already paired host add the new mode
#define MAX_REPORT 64
#define MAX_DESC   600

static bool s_running;                    // radio initialised
static volatile bool s_pairing;           // discoverable and accepting a new host
static volatile bool s_forget;            // this pairing window started by forgetting every host
static volatile bool s_connected;         // host subscribed to input reports
static volatile bool s_want_pair, s_want_window;
static volatile bool s_powered;
static volatile bool s_paused;           // a USB host is using the guitar: Bluetooth stays quiet
static uint32_t s_pair_until;
static hci_con_handle_t s_con = HCI_CON_HANDLE_INVALID;
static uint8_t s_report[MAX_REPORT];
static uint16_t s_report_len;
static uint8_t s_desc[MAX_DESC];
static uint16_t s_desc_len;
static char s_name[24];
static uint16_t s_appearance;
static uint8_t s_adv[31];
static uint8_t s_adv_len;
static btstack_packet_callback_registration_t s_hci_cb, s_sm_cb, s_l2cap_cb;

// ---------------------------------------------------------------- event log (read over USB by the configurator)
enum { L_BOOT = 1, L_WORKING, L_ADV, L_CONNECT, L_ENCRYPT, L_DISCONNECT, L_JUSTWORKS, L_PAIRED, L_SUBSCRIBE,
       L_PAUSE, L_WINDOW, L_REENCRYPT, L_PARAMS, L_LTK, L_PEER, L_CONNUPD, L_SVCCHG, L_MTU, L_READ, L_PDU };
#define LOG_N 48
static struct { uint32_t t; uint8_t code, a; uint16_t b; } s_log[LOG_N];
static uint8_t s_log_head, s_log_count;
#if YACC_BT_LOG_FLASH
static void flog_push(uint32_t t, uint8_t code, uint8_t a, uint16_t b);
#endif
static void blog(uint8_t code, uint8_t a, uint16_t b) {
    if (!(g_cfg.flags & CFG_FLAG_BT_DEBUG_LOG)) return;   // off unless debug logging is switched on in the configurator
#if YACC_BT_LOG_FLASH
    flog_push(to_ms_since_boot(get_absolute_time()), code, a, b);
#endif
    s_log[s_log_head].t = to_ms_since_boot(get_absolute_time());
    s_log[s_log_head].code = code; s_log[s_log_head].a = a; s_log[s_log_head].b = b;
    s_log_head = (uint8_t)((s_log_head + 1) % LOG_N);
    if (s_log_count < LOG_N) s_log_count++;
}

// ---------------------------------------------------------------- debug logging: log kept in flash
// Only while Bluetooth debug logging is switched on (Setup > Bluetooth in the configurator, off by default):
// every event is also appended to 16 KB of flash (four sectors just below the Bluetooth bond storage), so it
// survives power cycles until it is cleared from the configurator. With logging off nothing is recorded.
// Flash is only written from the main loop (bt_task), never from the Bluetooth interrupt context.
#if YACC_BT_LOG_FLASH
#include "hardware/flash.h"
#include "pico/flash.h"
#define FL_SECTORS 4
#define FL_SIZE    (FL_SECTORS * FLASH_SECTOR_SIZE)
#define FL_OFFSET  (PICO_FLASH_SIZE_BYTES - 8 * FLASH_SECTOR_SIZE)   // sectors -8..-5; -4 free, -3..-2 bonds, -1 config
typedef struct { uint32_t seq, t; uint16_t boot; uint8_t code, a; uint16_t b, pad; } frec_t;   // 16 bytes
static frec_t s_q[64];
static volatile uint8_t s_qh, s_qt;                 // queue head (producer) / tail (main loop)
static uint32_t s_fseq, s_foff;
static uint16_t s_fboot;
static bool s_fready;
static volatile bool s_fclear;
static const frec_t *frec(uint32_t off) { return (const frec_t *)(XIP_BASE + FL_OFFSET + off); }

static void flog_init(void) {
    uint32_t best = 0, best_off = 0; bool any = false; uint16_t boot = 0;
    for (uint32_t off = 0; off < FL_SIZE; off += sizeof(frec_t)) {
        const frec_t *r = frec(off);
        if (r->seq == 0xFFFFFFFFu) continue;
        if (!any || r->seq > best) { best = r->seq; best_off = off; boot = r->boot; any = true; }
    }
    s_fseq = any ? best + 1 : 1;
    s_fboot = any ? (uint16_t)(boot + 1) : 1;
    s_foff = any ? (best_off + sizeof(frec_t)) % FL_SIZE : 0;
    s_fready = true;
}
static void flog_push(uint32_t t, uint8_t code, uint8_t a, uint16_t b) {
    uint8_t n = (uint8_t)((s_qh + 1) % 64);
    if (n == s_qt) return;                             // queue full: drop (main loop is stalled)
    s_q[s_qh] = (frec_t){ 0, t, 0, code, a, b, 0xFFFF };
    s_qh = n;
}
typedef struct { bool erase; uint32_t off; const uint8_t *page; } fop_t;
static void fop(void *p) {
    const fop_t *o = (const fop_t *)p;
    if (o->erase) flash_range_erase(FL_OFFSET + o->off, FLASH_SECTOR_SIZE);
    else flash_range_program(FL_OFFSET + o->off, o->page, FLASH_PAGE_SIZE);
}
static bool sector_blank(uint32_t off) {
    const uint32_t *w = (const uint32_t *)(XIP_BASE + FL_OFFSET + off);
    for (uint32_t i = 0; i < FLASH_SECTOR_SIZE / 4; i++) if (w[i] != 0xFFFFFFFFu) return false;
    return true;
}
static void flog_flush(void) {
    if (!s_fready) return;
    if (s_fclear) {
        s_fclear = false;
        for (uint32_t off = 0; off < FL_SIZE; off += FLASH_SECTOR_SIZE) { fop_t o = { true, off, NULL }; flash_safe_execute(fop, &o, 500); }
        s_foff = 0;
    }
    while (s_qt != s_qh) {
        frec_t r = s_q[s_qt];
        r.seq = s_fseq++; r.boot = s_fboot;
        if (s_foff % FLASH_SECTOR_SIZE == 0 && !sector_blank(s_foff)) {   // wrapped onto old records: drop the oldest 4 KB
            fop_t o = { true, s_foff, NULL }; flash_safe_execute(fop, &o, 500);
        }
        static uint8_t page[FLASH_PAGE_SIZE];
        memset(page, 0xFF, sizeof(page));                // 0xFF leaves the other records in the page untouched
        uint32_t in_page = s_foff % FLASH_PAGE_SIZE;
        memcpy(&page[in_page], &r, sizeof(r));
        fop_t o = { false, s_foff - in_page, page };
        flash_safe_execute(fop, &o, 500);
        s_foff = (s_foff + sizeof(frec_t)) % FL_SIZE;
        s_qt = (uint8_t)((s_qt + 1) % 64);
    }
}
const uint8_t *bt_log_flash(uint16_t *len) { *len = FL_SIZE; return (const uint8_t *)(XIP_BASE + FL_OFFSET); }

// Every ATT, Security Manager and LE signalling PDU in either direction, through BTstack's packet dump hook:
// a = opcode, b = direction (0x8000 = from the host) | channel (0x4000 SM, 0x2000 signalling) | ATT handle,
// or for an ATT error: 0x1000 | error code << 8 | request opcode. Shows exactly what a host asked for last.
#include "hci_dump.h"
static void pdu_log(uint8_t packet_type, uint8_t in, uint8_t *p, uint16_t len) {
    if (!(g_cfg.flags & CFG_FLAG_BT_DEBUG_LOG)) return;
    if (packet_type != HCI_ACL_DATA_PACKET || len < 9) return;
    if (((p[1] >> 4) & 3) == 1) return;                 // continuation fragment: no L2CAP header
    uint16_t cid = little_endian_read_16(p, 6);
    const uint8_t *d = &p[8]; uint16_t n = len - 8;
    uint16_t b = in ? 0x8000 : 0;
    if (cid == 4) {
        if (d[0] == 0x01 && n >= 5) b |= 0x1000 | (uint16_t)(d[4] << 8) | d[1];
        else if (n >= 3 && d[0] != 0x1B && d[0] != 0x1D && d[0] != 0x0B && d[0] != 0x0D && d[0] != 0x09 && d[0] != 0x11)
            b |= little_endian_read_16(d, 1) & 0x0FFF;  // requests / notifications carry a handle
        if (d[0] == 0x1B && !in) return;                 // input report notifications: too many to keep
    } else if (cid == 6) b |= 0x4000;
    else if (cid == 5) b |= 0x2000;
    else return;
    flog_push(to_ms_since_boot(get_absolute_time()), L_PDU, d[0], b);
}
static void pdu_reset(void) {}
static void pdu_msg(int level, const char *fmt, va_list args) { (void)level; (void)fmt; (void)args; }
static const hci_dump_t s_pdu_dump = { pdu_reset, pdu_log, pdu_msg };
void bt_log_flash_clear(void) { s_fclear = true; }
#else
const uint8_t *bt_log_flash(uint16_t *len) { *len = 0; return NULL; }
void bt_log_flash_clear(void) {}
#endif

// ---------------------------------------------------------------- identity of the running mode
static const char *mode_short(uint8_t m) {
    switch (m) {
        case MODE_XINPUT:   return "XInput";
        case MODE_PS3_GH:   return "PS3 GH";
        case MODE_PS3_RB:   return "PS3 RB";
        case MODE_HID:      return "HID";
        case MODE_KEYBOARD: return "Keyboard";
        case MODE_SWITCH:   return "Switch";
        case MODE_WII_RB:   return "Wii RB";
        case MODE_OGXBOX:   return "OG Xbox";
        case MODE_PS4:      return "PS4";
        case MODE_XBONE:    return "Xbox One";
        default:            return "Guitar";
    }
}

// Bluetooth report map: the USB one with only its input reports, all with report id 1.
// - Output and feature reports are dropped (with the local items that belong to them): over USB they carry
//   console handshakes and LEDs; over Bluetooth every report in the map needs its own GATT characteristic
//   and Windows rejects the HID service when one is missing (PS4 mode alone has 40+ feature reports).
// - Maps without report ids get "Report ID 1" right after the top-level Collection (Application); the input
//   report bytes stay exactly the same as over USB.
static void build_descriptor(void) {
    uint16_t n;
    const uint8_t *d = usb_hid_report_desc(&n);
    static uint8_t tmp[MAX_DESC];
    uint16_t o = 0;
    uint16_t loc_pos[32]; uint8_t loc_len[32]; int nloc = 0;   // local items since the last main item
    bool has_ids = false;
    for (uint16_t i = 0; i < n;) {
        uint8_t p = d[i], sz = (p & 3) == 3 ? 4 : (p & 3), kind = p & 0x0C;
        if (i + 1 + sz > n || o + 1 + sz > MAX_DESC) break;
        if (kind == 0x00 && ((p & 0xFC) == 0x90 || (p & 0xFC) == 0xB0)) {
            for (int k = nloc - 1; k >= 0; k--) {     // drop its locals (usages), last first so positions hold
                memmove(&tmp[loc_pos[k]], &tmp[loc_pos[k] + loc_len[k]], o - loc_pos[k] - loc_len[k]);
                o -= loc_len[k];
            }
            nloc = 0; i += 1 + sz; continue;
        }
        if (kind == 0x08 && nloc < 32) { loc_pos[nloc] = o; loc_len[nloc] = (uint8_t)(1 + sz); nloc++; }
        if (kind == 0x00) nloc = 0;
        if ((p & 0xFC) == 0x84) has_ids = true;
        memcpy(&tmp[o], &d[i], 1 + sz); o += 1 + sz;
        i += 1 + sz;
    }
    if (has_ids || o + 2 > MAX_DESC) { memcpy(s_desc, tmp, o); s_desc_len = o; return; }
    uint16_t q = 0; bool done = false;
    for (uint16_t i = 0; i < o;) {
        uint8_t p = tmp[i], sz = (p & 3) == 3 ? 4 : (p & 3);
        memcpy(&s_desc[q], &tmp[i], 1 + sz); q += 1 + sz;
        if (!done && p == 0xA1 && sz == 1 && tmp[i + 1] == 0x01) { s_desc[q++] = 0x85; s_desc[q++] = 0x01; done = true; }
        i += 1 + sz;
    }
    s_desc_len = q;
}

static void build_adv(bool discoverable) {
    uint8_t *a = s_adv; uint8_t name_len = (uint8_t)strlen(s_name);
    *a++ = 2; *a++ = BLUETOOTH_DATA_TYPE_FLAGS; *a++ = 0x06;   // always general discoverable, like Santroller (see set_adv)
    (void)discoverable;
    *a++ = 3; *a++ = BLUETOOTH_DATA_TYPE_COMPLETE_LIST_OF_16_BIT_SERVICE_CLASS_UUIDS; *a++ = 0x12; *a++ = 0x18;
    *a++ = 3; *a++ = BLUETOOTH_DATA_TYPE_APPEARANCE; *a++ = (uint8_t)s_appearance; *a++ = (uint8_t)(s_appearance >> 8);
    if (name_len > 31 - 11 - 2) name_len = 31 - 11 - 2;
    *a++ = (uint8_t)(name_len + 1); *a++ = BLUETOOTH_DATA_TYPE_COMPLETE_LOCAL_NAME;
    memcpy(a, s_name, name_len); a += name_len;
    s_adv_len = (uint8_t)(a - s_adv);
}

static void set_adv(bool discoverable) {
    bd_addr_t null_addr = {0};
    if (s_paused) { gap_advertisements_enable(0); return; }
    build_adv(discoverable);
    gap_advertisements_enable(0);
    uint16_t itv = discoverable ? 0x0030 : 0x00A0;  // 30 ms while pairing, 100 ms waiting for a known host
    gap_advertisements_set_params(itv, itv, 0 /* connectable undirected */, 1 /* own random address */, null_addr, 0x07, 0x00);
    gap_advertisements_set_data(s_adv_len, s_adv);
    gap_advertisements_enable(1);
    blog(L_ADV, discoverable, 0);
}

static uint16_t att_read(hci_con_handle_t con, uint16_t handle, uint16_t offset, uint8_t *buf, uint16_t size) {
    (void)con;
    if (handle == ATT_CHARACTERISTIC_GAP_DEVICE_NAME_01_VALUE_HANDLE)
        return att_read_callback_handle_blob((const uint8_t *)s_name, (uint16_t)strlen(s_name), offset, buf, size);
    if (handle == ATT_CHARACTERISTIC_GAP_APPEARANCE_01_VALUE_HANDLE) {
        uint8_t v[2] = { (uint8_t)s_appearance, (uint8_t)(s_appearance >> 8) };
        return att_read_callback_handle_blob(v, 2, offset, buf, size);
    }
    return 0;
}

// ---------------------------------------------------------------- bonds, one list per mode
// BTstack's LE device database stores entry i under tag 'BTD' i. Give it a view of the TLV store where that
// becomes 'BM' <mode> i, so every mode keeps its own bonds.
static const btstack_tlv_t *s_tlv;
static void *s_tlv_ctx;
// 'BP' since v0.22 (per-mode IRKs, see map_tag; new addresses); the 'BM' / 'BN' / 'BO' bonds of v0.14-v0.21 are dropped
#define BOND_TAG(mode, i) (((uint32_t)'B' << 24) | ((uint32_t)'P' << 16) | ((uint32_t)(mode) << 8) | (uint32_t)(i))
#define OLD_BOND_TAG(c, mode, i) (((uint32_t)'B' << 24) | ((uint32_t)(c) << 16) | ((uint32_t)(mode) << 8) | (uint32_t)(i))
// per bond: the database hash the host last discovered ('SG' mode i), as Santroller's bt_gatt_changes
#define HASH_TAG(mode, i) (((uint32_t)'S' << 24) | ((uint32_t)'G' << 16) | ((uint32_t)(mode) << 8) | (uint32_t)(i))
// Since v0.22 this view is BTstack's TLV instance for everything, not just the device database, so the other
// per-host state is per mode too:
// - 'SMIR' / 'SMER': the identity root (IR) the IRK every bond receives is derived from, and ER. With one
//   IR every mode handed hosts the same IRK; Windows then took a newly paired mode for a device it already
//   had and the pairing failed until the other mode's device was removed.
// - 'BTC' i: the input report subscription BTstack restores for bond i on reconnect (bond i differs per mode)
// - 'BTDB': the database hash BTstack keeps (falls under 'BTD' below)
#define TAG4(a, b, c, d) (((uint32_t)(a) << 24) | ((uint32_t)(b) << 16) | ((uint32_t)(c) << 8) | (uint32_t)(d))
#define CCC_TAG(mode, i) TAG4('C', 'C', (mode), (i))
static uint32_t map_tag(uint32_t tag) {
    if ((tag >> 8) == ((((uint32_t)'B') << 16) | (((uint32_t)'T') << 8) | 'D')) return BOND_TAG(g_usb_mode, tag & 0xFF);
    if ((tag >> 8) == ((((uint32_t)'B') << 16) | (((uint32_t)'T') << 8) | 'C')) return CCC_TAG(g_usb_mode, tag & 0xFF);
    if (tag == TAG4('S', 'M', 'I', 'R')) return TAG4('S', 'I', g_usb_mode, 'R');
    if (tag == TAG4('S', 'M', 'E', 'R')) return TAG4('S', 'E', g_usb_mode, 'R');
    return tag;
}
static int mt_get(void *c, uint32_t tag, uint8_t *buf, uint32_t size) { return s_tlv->get_tag(c, map_tag(tag), buf, size); }
static int mt_store(void *c, uint32_t tag, const uint8_t *d, uint32_t size) { return s_tlv->store_tag(c, map_tag(tag), d, size); }
static void mt_delete(void *c, uint32_t tag) { s_tlv->delete_tag(c, map_tag(tag)); }
static const btstack_tlv_t mode_tlv = { mt_get, mt_store, mt_delete };

// Only the running mode: every mode is its own Bluetooth device, so pairing one mode again (Star power at
// power-on) must not cost the others their pairings. Until v0.22 this wiped every mode, and pairing each
// new mode that way left only the last one paired.
static void forget_this_mode(void) {
    if (!s_tlv) return;
    for (int i = 0; i < NVM_NUM_DEVICE_DB_ENTRIES; i++) {
        s_tlv->delete_tag(s_tlv_ctx, HASH_TAG(g_usb_mode, i));
        s_tlv->delete_tag(s_tlv_ctx, CCC_TAG(g_usb_mode, i));
    }
}

// ---------------------------------------------------------------- Service Changed (from Santroller's bt_gatt_changes)
// Hosts cache a bonded device's GATT layout. Store the database hash each host last discovered, and when a
// bonded host comes back to a different database (a firmware update), indicate Service Changed so it
// discovers again instead of talking to stale handles.
static hci_con_handle_t s_sc_handle = HCI_CON_HANDLE_INVALID;
static int s_sc_index = -1;
static uint16_t s_sc_cccd;
static btstack_context_callback_registration_t s_sc_reg;
static att_service_handler_t s_gatt_service;
// Fingerprint of the database (this BTstack has no gatt_server_get_database_hash): FNV-1a over the compiled
// attribute table plus the HID report map, the parts a host caches.
static bool db_hash(uint8_t *h) {
    uint32_t x = 2166136261u;
    for (size_t i = 0; i < sizeof(profile_data); i++) { x ^= profile_data[i]; x *= 16777619u; }
    for (uint16_t i = 0; i < s_desc_len; i++) { x ^= s_desc[i]; x *= 16777619u; }
    memcpy(h, &x, 4);
    return true;
}
static void hash_remember(int index) {
    uint8_t h[4], old[4];
    if (!s_tlv || index < 0 || !db_hash(h)) return;
    if (s_tlv->get_tag(s_tlv_ctx, HASH_TAG(g_usb_mode, index), old, 4) == 4 && memcmp(old, h, 4) == 0) return;
    s_tlv->store_tag(s_tlv_ctx, HASH_TAG(g_usb_mode, index), h, 4);
}
static void send_service_changed(void *ctx) {
    (void)ctx;
    if (s_sc_handle == HCI_CON_HANDLE_INVALID) return;
    uint8_t range[4];
    little_endian_store_16(range, 0, 0x0001);
    little_endian_store_16(range, 2, 0xFFFF);
    att_server_indicate(s_sc_handle, ATT_CHARACTERISTIC_GATT_SERVICE_CHANGED_01_VALUE_HANDLE, range, sizeof(range));
}
static void check_host(hci_con_handle_t h) {
    if (s_sc_handle == h) return;
    int index = sm_le_device_index(h);
    uint8_t cur[4], old[4];
    if (!s_tlv || index < 0 || !db_hash(cur)) return;
    if (s_tlv->get_tag(s_tlv_ctx, HASH_TAG(g_usb_mode, index), old, 4) == 4 && memcmp(old, cur, 4) == 0) return;
    blog(L_SVCCHG, 0xFF, (uint16_t)index);          // sending
    s_sc_handle = h; s_sc_index = index;
    s_sc_reg.callback = &send_service_changed; s_sc_reg.context = NULL;
    att_server_request_to_send_indication(&s_sc_reg, h);
}
static uint16_t gatt_read(hci_con_handle_t con, uint16_t handle, uint16_t offset, uint8_t *buf, uint16_t size) {
    (void)con;
    if (handle == ATT_CHARACTERISTIC_GATT_SERVICE_CHANGED_01_CLIENT_CONFIGURATION_HANDLE)
        return att_read_callback_handle_little_endian_16(s_sc_cccd, offset, buf, size);
    return 0;
}
static int gatt_write(hci_con_handle_t con, uint16_t handle, uint16_t mode, uint16_t offset, uint8_t *buf, uint16_t size) {
    (void)con;
    if (mode == ATT_TRANSACTION_MODE_NONE && handle == ATT_CHARACTERISTIC_GATT_SERVICE_CHANGED_01_CLIENT_CONFIGURATION_HANDLE && offset == 0 && size == 2)
        s_sc_cccd = little_endian_read_16(buf, 0);
    return 0;
}

// Hosts (Windows among them) read the input report when they start the device: answer with the current one
static void get_report(hci_con_handle_t con, hid_report_type_t type, uint16_t id, uint16_t max, uint8_t *out) {
    (void)con; (void)id;
    blog(L_READ, (uint8_t)type, (uint16_t)id);
    memset(out, 0, max);
    if (type == HID_REPORT_TYPE_INPUT) memcpy(out, s_report, s_report_len < max ? s_report_len : max);
}

// A notification carries at most MTU - 3 bytes. Until the host exchanges a bigger MTU (Windows does that
// only after re-encrypting, while the subscription is already restored), it is 23: 20 bytes. BTstack's
// att_server_notify copies MTU - 3 bytes of a longer value but still sends a PDU of the full length, with
// junk at the end and bigger than the MTU, and Windows drops the link for it. That's why HID mode (7 byte
// report) reconnected and PS3 (27), PS4 (63) didn't. Hold a report back until it fits.
static bool report_fits(void) {
    return s_con != HCI_CON_HANDLE_INVALID && (uint16_t)(s_report_len + 3) <= att_server_get_mtu(s_con);
}

// ---------------------------------------------------------------- pairing
static void open_pairing(bool forget, uint32_t ms) {   // stack running; its context or under the lock
    if (forget) {
        if (s_con != HCI_CON_HANDLE_INVALID) gap_disconnect(s_con);
        for (int i = 0; i < le_device_db_max_count(); i++) le_device_db_remove(i);   // this mode's bonds (keeps the cache right)
        forget_this_mode();
    }
    blog(L_WINDOW, forget, (uint16_t)(ms / 1000));
    s_pairing = true;
    s_forget = forget;
    s_pair_until = to_ms_since_boot(get_absolute_time()) + ms;
    if (s_con == HCI_CON_HANDLE_INVALID) set_adv(true);
    if (!s_paused) rgb_set_bt(RGB_BT_PAIRING);
}

static void packet_handler(uint8_t type, uint16_t channel, uint8_t *packet, uint16_t size) {
    (void)channel; (void)size;
    if (type != HCI_EVENT_PACKET) return;
    switch (hci_event_packet_get_type(packet)) {
        case BTSTACK_EVENT_STATE:
            if (btstack_event_state_get_state(packet) != HCI_STATE_WORKING) break;
            s_powered = true;
            blog(L_WORKING, g_usb_mode, 0);
            if (s_want_pair) { s_want_pair = false; open_pairing(true, PAIRING_TIMEOUT_MS); }
            else if (s_want_window) { s_want_window = false; open_pairing(false, WINDOW_TIMEOUT_MS); }
            else set_adv(false);
            break;
        case HCI_EVENT_ENCRYPTION_CHANGE:
        case HCI_EVENT_ENCRYPTION_CHANGE_V2: {
            bool v2 = hci_event_packet_get_type(packet) == HCI_EVENT_ENCRYPTION_CHANGE_V2;
            blog(L_ENCRYPT, v2 ? hci_event_encryption_change_v2_get_encryption_enabled(packet) : hci_event_encryption_change_get_encryption_enabled(packet),
                 v2 ? hci_event_encryption_change_v2_get_status(packet) : hci_event_encryption_change_get_status(packet));
            uint8_t on = v2 ? hci_event_encryption_change_v2_get_encryption_enabled(packet)
                            : hci_event_encryption_change_get_encryption_enabled(packet);
            hci_con_handle_t h = v2 ? hci_event_encryption_change_v2_get_connection_handle(packet)
                                    : hci_event_encryption_change_get_connection_handle(packet);
            // v0.18: like Santroller, nothing is sent until the host subscribes to input reports (Windows
            // writes the subscription again on every reconnect, the log shows), and connection parameters are
            // requested only then.
            uint8_t st = v2 ? hci_event_encryption_change_v2_get_status(packet) : hci_event_encryption_change_get_status(packet);
            if (on && st == ERROR_CODE_SUCCESS) check_host(h);
            break;
        }
        case HCI_EVENT_LE_META:
            if (hci_event_le_meta_get_subevent_code(packet) == HCI_SUBEVENT_LE_CONNECTION_COMPLETE) {
                s_con = hci_subevent_le_connection_complete_get_connection_handle(packet);
                blog(L_CONNECT, hci_subevent_le_connection_complete_get_status(packet), hci_subevent_le_connection_complete_get_peer_address_type(packet));
                bd_addr_t pa;
                hci_subevent_le_connection_complete_get_peer_address(packet, pa);
                blog(L_PEER, pa[3], (uint16_t)((pa[4] << 8) | pa[5]));   // last three bytes: tells two hosts apart
            } else if (hci_event_le_meta_get_subevent_code(packet) == HCI_SUBEVENT_LE_CONNECTION_UPDATE_COMPLETE) {
                blog(L_CONNUPD, hci_subevent_le_connection_update_complete_get_status(packet),
                     hci_subevent_le_connection_update_complete_get_conn_interval(packet));
            } else if (hci_event_le_meta_get_subevent_code(packet) == HCI_SUBEVENT_LE_LONG_TERM_KEY_REQUEST) {
                // the host starts encryption with a stored key. EDIV / Rand are zero for a Secure Connections key
                // (the only kind this firmware makes); non-zero means the host holds an old legacy key.
                uint8_t legacy = hci_subevent_le_long_term_key_request_get_encryption_diversifier(packet) != 0;
                for (int i = 5; i < 13; i++) if (packet[i]) legacy = 1;
                blog(L_LTK, legacy, hci_subevent_le_long_term_key_request_get_encryption_diversifier(packet));
            }
            break;
        case HCI_EVENT_DISCONNECTION_COMPLETE:
            blog(L_DISCONNECT, hci_event_disconnection_complete_get_reason(packet), 0);
            if (hci_event_disconnection_complete_get_connection_handle(packet) == s_sc_handle) { s_sc_handle = HCI_CON_HANDLE_INVALID; s_sc_index = -1; }
            s_sc_cccd = 0;
            s_con = HCI_CON_HANDLE_INVALID;
            s_connected = false;
            set_adv(s_pairing);
            rgb_set_bt(s_pairing && !s_paused ? RGB_BT_PAIRING : RGB_BT_OFF);
            break;
        case SM_EVENT_REENCRYPTION_COMPLETE:
            blog(L_REENCRYPT, sm_event_reencryption_complete_get_status(packet), 0);
            if (sm_event_reencryption_complete_get_status(packet) == ERROR_CODE_SUCCESS)
                check_host(sm_event_reencryption_complete_get_handle(packet));
            break;
        case ATT_EVENT_HANDLE_VALUE_INDICATION_COMPLETE:
            if (att_event_handle_value_indication_complete_get_conn_handle(packet) == s_sc_handle &&
                att_event_handle_value_indication_complete_get_attribute_handle(packet) == ATT_CHARACTERISTIC_GATT_SERVICE_CHANGED_01_VALUE_HANDLE) {
                uint8_t st = att_event_handle_value_indication_complete_get_status(packet);
                blog(L_SVCCHG, st, (uint16_t)s_sc_index);
                if (st == ERROR_CODE_SUCCESS) hash_remember(s_sc_index);
                s_sc_handle = HCI_CON_HANDLE_INVALID; s_sc_index = -1;
            }
            break;
        case ATT_EVENT_MTU_EXCHANGE_COMPLETE:
            blog(L_MTU, 0, att_event_mtu_exchange_complete_get_MTU(packet));
            // a report held back for the default 23 byte MTU can go now
            if (s_connected && s_con != HCI_CON_HANDLE_INVALID && s_report_len) hids_device_request_can_send_now_event(s_con);
            break;
        case SM_EVENT_JUST_WORKS_REQUEST:
            blog(L_JUSTWORKS, s_pairing, 0);
            // always accept (as Santroller does): a host whose key went stale can pair again instead of being
            // locked out; "pairing mode" forgets old hosts and advertises faster
            sm_just_works_confirm(sm_event_just_works_request_get_handle(packet));
            break;
        case SM_EVENT_PAIRING_COMPLETE:
            blog(L_PAIRED, sm_event_pairing_complete_get_status(packet), sm_event_pairing_complete_get_reason(packet));
            if (sm_event_pairing_complete_get_status(packet) == ERROR_CODE_SUCCESS) {
                s_pairing = false;
                hash_remember(sm_le_device_index(sm_event_pairing_complete_get_handle(packet)));   // a new bond discovers everything
            }
            break;
        case HCI_EVENT_HIDS_META:
            switch (hci_event_hids_meta_get_subevent_code(packet)) {
                case HIDS_SUBEVENT_INPUT_REPORT_ENABLE:
                    s_con = hids_subevent_input_report_enable_get_con_handle(packet);
                    s_connected = hids_subevent_input_report_enable_get_enable(packet) != 0;
                    blog(L_SUBSCRIBE, s_connected, 0);
                    if (s_connected) {
                        // as Santroller: 7.5-8.75 ms, no latency, 1 s supervision timeout
                        gap_request_connection_parameter_update(s_con, 6, 7, 0, 100);
                        s_pairing = false;
                        rgb_set_bt(RGB_BT_CONNECTED);
                        if (s_report_len) hids_device_request_can_send_now_event(s_con);
                    }
                    break;
                case HIDS_SUBEVENT_CAN_SEND_NOW:
                    if (s_con != HCI_CON_HANDLE_INVALID && s_report_len && report_fits())
                        hids_device_send_input_report(s_con, s_report, s_report_len);
                    break;
                default: break;
            }
            break;
        default: break;
    }
}

// L2CAP passes some HCI events on to its handlers too: only take its own here, so nothing is handled twice
static void l2cap_handler(uint8_t type, uint16_t channel, uint8_t *packet, uint16_t size) {
    (void)channel; (void)size;
    if (type == HCI_EVENT_PACKET && hci_event_packet_get_type(packet) == L2CAP_EVENT_CONNECTION_PARAMETER_UPDATE_RESPONSE)
        blog(L_PARAMS, (uint8_t)little_endian_read_16(packet, 4), 0);
}

// ---------------------------------------------------------------- API
bool bt_supported(void) { return true; }
bool bt_running(void) { return s_running; }

void bt_init(bool enabled, bool pair, bool open_window) {
    if (s_running || (!enabled && !pair)) return;   // radio stays off: no power, no PIO or DMA used
#if YACC_BT_LOG_FLASH
    flog_init();
#endif
    if (cyw43_arch_init()) return;
    s_running = true;
    blog(L_BOOT, (uint8_t)(pair | (open_window << 1)), g_usb_mode);
    s_want_pair = pair;
    s_want_window = open_window && !pair;

    // identity of the running mode
    snprintf(s_name, sizeof(s_name), "YAGCC %s", mode_short(g_usb_mode));
    s_appearance = g_usb_mode == MODE_KEYBOARD ? 0x03C1 : 0x03C4;   // HID keyboard / HID gamepad
    build_descriptor();
    uint16_t vid, pid, ver;
    usb_mode_ids(&vid, &pid, &ver);
    pico_unique_board_id_t uid;
    pico_get_unique_board_id(&uid);
    bd_addr_t addr;                                  // static random address, different for every mode
    for (int i = 0; i < 6; i++) addr[i] = uid.id[2 + i];
    addr[5] ^= (uint8_t)(g_usb_mode * 0x2B + 1);
    // v0.17: new addresses. Windows can keep a hidden, stale record (with an old legacy key) for an address it
    // was once paired with; it then keeps trying that key alongside the current one and the link fails with a
    // MIC error (0x3D) on every other attempt. Fresh addresses leave any such record behind for good.
    // (v0.17 used 0xA7 here; v0.18 changed the GATT database, which hosts cache per address.)
    addr[4] ^= 0x3E;                                 // v0.22: per-mode IRKs, so every mode is paired fresh
    addr[0] |= 0xC0;                                 // static random: top two bits set

    l2cap_init();
    sm_init();
    sm_set_io_capabilities(IO_CAPABILITY_NO_INPUT_NO_OUTPUT);
    sm_set_authentication_requirements(SM_AUTHREQ_SECURE_CONNECTION | SM_AUTHREQ_BONDING);
    // A host with a key we don't have gets "key missing" (0x06) instead of a made-up legacy key that fails with
    // a MIC error, so it knows to pair again instead of retrying forever.
    sm_allow_ltk_reconstruction_without_le_device_db_entry(0);
    // per-mode bond list (see above); bonds from the older firmware ('BTD' tags, legacy keys) are dropped
    btstack_tlv_get_instance(&s_tlv, &s_tlv_ctx);
    if (s_tlv) {
        for (int i = 0; i < NVM_NUM_DEVICE_DB_ENTRIES; i++) {
            s_tlv->delete_tag(s_tlv_ctx, (((uint32_t)'B') << 24) | (((uint32_t)'T') << 16) | (((uint32_t)'D') << 8) | (uint32_t)i);
            for (int m = 0; m < NUM_MODES; m++) { s_tlv->delete_tag(s_tlv_ctx, OLD_BOND_TAG('M', m, i)); s_tlv->delete_tag(s_tlv_ctx, OLD_BOND_TAG('N', m, i)); s_tlv->delete_tag(s_tlv_ctx, OLD_BOND_TAG('O', m, i)); }
            s_tlv->delete_tag(s_tlv_ctx, (((uint32_t)'B') << 24) | (((uint32_t)'T') << 16) | (((uint32_t)'C') << 8) | (uint32_t)i);   // shared CCCs of v0.21
        }
        le_device_db_tlv_configure(&mode_tlv, s_tlv_ctx);
        btstack_tlv_set_instance(&mode_tlv, s_tlv_ctx);   // SM keys and the ATT server's state, per mode too
    }
    att_server_init(profile_data, att_read, NULL);
    s_gatt_service.start_handle = ATT_SERVICE_GATT_SERVICE_START_HANDLE;
    s_gatt_service.end_handle = ATT_SERVICE_GATT_SERVICE_END_HANDLE;
    s_gatt_service.read_callback = &gatt_read;
    s_gatt_service.write_callback = &gatt_write;
    att_server_register_service_handler(&s_gatt_service);
    device_information_service_server_init();
    device_information_service_server_set_manufacturer_name("YAGCC");
    device_information_service_server_set_model_number(s_name);
    device_information_service_server_set_pnp_id(0x02 /* USB-IF ids */, vid, pid, ver);
    hids_device_init(0, s_desc, s_desc_len);
    gap_random_address_set_mode(GAP_RANDOM_ADDRESS_TYPE_STATIC);
    gap_random_address_set(addr);

    s_hci_cb.callback = &packet_handler;
    hci_add_event_handler(&s_hci_cb);
    s_sm_cb.callback = &packet_handler;
    sm_add_event_handler(&s_sm_cb);
    hids_device_register_packet_handler(packet_handler);
    hids_device_register_get_report_callback(get_report);
    att_server_register_packet_handler(packet_handler);       // MTU, indication results
    s_l2cap_cb.callback = &l2cap_handler;                     // connection parameter update responses
    l2cap_add_event_handler(&s_l2cap_cb);
#if YACC_BT_LOG_FLASH
    hci_dump_init(&s_pdu_dump);
#endif
    hci_power_control(HCI_POWER_ON);
    if (pair || open_window) rgb_set_bt(RGB_BT_PAIRING);
}

void bt_start_pairing(void) {
    if (!s_running) { bt_init(true, true, false); return; }
    async_context_t *ctx = cyw43_arch_async_context();
    async_context_acquire_lock_blocking(ctx);
    if (s_powered) open_pairing(true, PAIRING_TIMEOUT_MS); else s_want_pair = true;
    async_context_release_lock(ctx);
}

void bt_task(void) {
#if YACC_BT_LOG_FLASH
    flog_flush();
#endif
    if (!s_running || !s_pairing) return;
    if ((int32_t)(to_ms_since_boot(get_absolute_time()) - s_pair_until) <= 0) return;
    async_context_t *ctx = cyw43_arch_async_context();     // nobody paired in time: stop being discoverable
    async_context_acquire_lock_blocking(ctx);
    s_pairing = false;
    if (s_con == HCI_CON_HANDLE_INVALID) set_adv(false);
    rgb_set_bt(s_connected ? RGB_BT_CONNECTED : RGB_BT_OFF);
    async_context_release_lock(ctx);
}

uint8_t bt_state(void) {
    return s_connected ? BT_STATE_CONNECTED : s_pairing ? BT_STATE_PAIRING : BT_STATE_OFF;
}

void bt_send_report(const uint8_t *r, uint16_t len) {
    if (!s_running) return;
    if (len > MAX_REPORT) len = MAX_REPORT;
    async_context_t *ctx = cyw43_arch_async_context();
    async_context_acquire_lock_blocking(ctx);
    memcpy(s_report, r, len);
    s_report_len = len;
    if (s_connected && s_con != HCI_CON_HANDLE_INVALID) hids_device_request_can_send_now_event(s_con);
    async_context_release_lock(ctx);
}

void bt_set_usb_active(bool active) {
    if (!s_running || active == s_paused) return;
    async_context_t *ctx = cyw43_arch_async_context();
    async_context_acquire_lock_blocking(ctx);
    s_paused = active;
    blog(L_PAUSE, active, 0);
    if (active) {
        // plugged into a PC or console: stop advertising and drop any wireless host, so nothing gets input twice
        gap_advertisements_enable(0);
        if (s_con != HCI_CON_HANDLE_INVALID) gap_disconnect(s_con);
        rgb_set_bt(RGB_BT_OFF);
    } else if (s_powered) {
        set_adv(s_pairing);                    // unplugged again: back to waiting for the paired host
        if (s_pairing) rgb_set_bt(RGB_BT_PAIRING);
    }
    async_context_release_lock(ctx);
}

int bt_vbus(void) {
#ifdef CYW43_WL_GPIO_VBUS_PIN
    if (s_running) return cyw43_arch_gpio_get(CYW43_WL_GPIO_VBUS_PIN) ? 1 : 0;
#endif
    return -1;
}

uint16_t bt_log_read(uint8_t *out, uint16_t max) {
    uint16_t n = 0;
    uint8_t first = (uint8_t)((s_log_head + LOG_N - s_log_count) % LOG_N);
    for (uint8_t k = 0; k < s_log_count && n + 8 <= max; k++) {
        uint8_t i = (uint8_t)((first + k) % LOG_N);
        memcpy(&out[n], &s_log[i].t, 4); out[n + 4] = s_log[i].code; out[n + 5] = s_log[i].a;
        memcpy(&out[n + 6], &s_log[i].b, 2); n += 8;
    }
    return n;
}

#endif
