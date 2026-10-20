// PS5 guitar mode with a Besavior P5General dongle on the USB host port, after Santroller
// (src/emulation/usb/ps5_device.cpp, src/devices/usb/host/hid/ps5_host.cpp, include/hid_reports.h, GPL-3.0).
//
//   console --F0 challenge pages--> YAGCC --F0--> P5General
//   console --F2 status / F1 response pages--> YAGCC answers from the dongle's replies (fetched ahead)
//   input:  our report --OUT--> P5General --IN (signed copy)--> YAGCC --> console
// The PS5 checks the input reports too, which is why every report goes through the dongle.
#include <string.h>
#include "tusb.h"
#include "pico/time.h"
#include "ps5_auth.h"

#define RID_INPUT 0x01
#define RID_OUTPUT 0x02
#define RID_FEATURE 0x03
#define RID_E0 0xE0
#define RID_SET_CHALLENGE 0xF0
#define RID_GET_RESPONSE 0xF1
#define RID_GET_STATUS 0xF2

// Santroller's TUD_HID_REPORT_DESC_PS5_THIRDPARTY_GAMEPAD, expanded
static const uint8_t desc[] = {
    0x05, 0x01, 0x09, 0x05, 0xA1, 0x01,
    0x85, RID_INPUT,
    0x09, 0x30, 0x09, 0x31, 0x09, 0x32, 0x09, 0x35, 0x09, 0x33, 0x09, 0x34,   // X Y Z Rz Rx Ry
    0x15, 0x00, 0x26, 0xFF, 0x00, 0x75, 0x08, 0x95, 0x06, 0x81, 0x02,
    0x06, 0x00, 0xFF, 0x09, 0x20, 0x95, 0x01, 0x81, 0x02,
    0x05, 0x01, 0x09, 0x39, 0x15, 0x00, 0x25, 0x07, 0x35, 0x00, 0x46, 0x3B, 0x01, 0x65, 0x14,
    0x75, 0x04, 0x95, 0x01, 0x81, 0x42, 0x65, 0x00,
    0x05, 0x09, 0x19, 0x01, 0x29, 0x0E, 0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x0E, 0x81, 0x02,
    0x06, 0x00, 0xFF, 0x09, 0x21, 0x95, 0x0E, 0x81, 0x02,
    0x06, 0x00, 0xFF, 0x09, 0x22, 0x15, 0x00, 0x26, 0xFF, 0x00, 0x75, 0x08, 0x95, 0x34, 0x81, 0x02,
    0x85, RID_OUTPUT, 0x09, 0x23, 0x95, 0x2F, 0x91, 0x02,
    0x85, RID_FEATURE, 0x0A, 0x21, 0x28, 0x95, 0x2F, 0xB1, 0x02,
    0x06, 0x80, 0xFF, 0x85, RID_E0, 0x09, 0x57, 0x95, 0x02, 0xB1, 0x02,
    0xC0,
    0x06, 0xF0, 0xFF, 0x09, 0x40, 0xA1, 0x01,
    0x85, RID_SET_CHALLENGE, 0x09, 0x47, 0x95, 0x3F, 0xB1, 0x02,
    0x85, RID_GET_RESPONSE, 0x09, 0x48, 0x95, 0x3F, 0xB1, 0x02,
    0x85, RID_GET_STATUS, 0x09, 0x49, 0x95, 0x0F, 0xB1, 0x02,
    0xC0,
};
const uint8_t *ps5_report_desc(uint16_t *len) { *len = sizeof(desc); return desc; }

// feature 0x03 without its id: a third-party Rock Band guitar (Santroller: features lightbar | extended,
// type 1 = guitar, extended type 0x07 = Rock Band)
static const uint8_t feature_config[47] = {
    0x21, 0x28, 0x03, 0x14, 0x01, 0x2C, 0x56, 0x01, 0x00, 0xD0, 0x07, 0x00, 0x80, 0x04, 0x00, 0x00,
    0x80, 0x0D, 0x0D, 0x84, 0x00, 0x00, 0x00, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};

static uint32_t crc32(const uint8_t *d, size_t n) {
    uint32_t c = 0xFFFFFFFFu;
    for (size_t i = 0; i < n; i++) {
        c ^= d[i];
        for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & (uint32_t)-(int32_t)(c & 1));
    }
    return ~c;
}
static inline uint32_t now_ms() { return to_ms_since_boot(get_absolute_time()); }

// ---- dongle
static uint8_t d_addr = 0xFF, d_inst = 0xFF;
static volatile bool present;
bool ps5_dongle_present(void) { return present; }

static uint8_t xfer_buf[64];                 // host control transfers, id at [0]
static volatile bool busy;
static uint32_t busy_since;

static uint8_t challenge[8][64];             // console F0 pages waiting to go to the dongle (id stripped)
static volatile uint8_t ch_head, ch_tail;
static uint8_t seq;                          // sequence byte of the console's current challenge
static uint8_t status_cache[15];             // last F2 from the dongle (id stripped)
static volatile bool status_valid, status_ready;   // a status for the current challenge / it says signed
static uint8_t resp_cache[63];               // next F1 page from the dongle (id stripped)
static volatile bool resp_valid, want_resp;
static uint32_t last_status_poll;

static uint8_t in_report[64];                // the dongle's signed copy of our last report
static volatile bool in_new, out_pending;

bool ps5_host_is_dongle(uint8_t dev_addr) {
    uint16_t vid = 0, pid = 0;
    return tuh_vid_pid_get(dev_addr, &vid, &pid) && vid == P5GENERAL_VID && pid == P5GENERAL_PID;
}

void ps5_host_mount(uint8_t dev_addr, uint8_t instance) {
    if (present) return;
    d_addr = dev_addr; d_inst = instance;
    busy = false; ch_head = ch_tail = 0; status_valid = status_ready = resp_valid = want_resp = false;
    in_new = out_pending = false;
    present = true;
}
void ps5_host_unmount(uint8_t dev_addr) {
    if (!present || dev_addr != d_addr) return;
    present = false;
    d_addr = d_inst = 0xFF;
}
void ps5_host_report(uint8_t dev_addr, uint8_t instance, const uint8_t *report, uint16_t len) {
    if (!present || dev_addr != d_addr || instance != d_inst) return;
    memset(in_report, 0, sizeof(in_report));
    memcpy(in_report, report, len < sizeof(in_report) ? len : sizeof(in_report));
    in_new = true;
    out_pending = false;
}
void ps5_host_set_report_complete(uint8_t dev_addr, uint8_t instance, uint8_t report_id, uint16_t len) {
    (void)len; (void)report_id;
    if (dev_addr != d_addr || instance != d_inst) return;
    busy = false;
}
void ps5_host_get_report_complete(uint8_t dev_addr, uint8_t instance, uint8_t report_id, uint16_t len) {
    if (dev_addr != d_addr || instance != d_inst) return;
    busy = false;
    if (!len) return;
    if (report_id == RID_GET_STATUS) {
        memcpy(status_cache, &xfer_buf[1], sizeof(status_cache));
        status_valid = true;
        status_ready = xfer_buf[2] == 0;           // [1] sequence, [2] 0 = signed, 16 = still signing
        if (status_ready && !resp_valid) want_resp = true;
        last_status_poll = now_ms();
    } else if (report_id == RID_GET_RESPONSE) {
        memcpy(resp_cache, &xfer_buf[1], sizeof(resp_cache));
        resp_valid = true;
    }
}

void ps5_auth_task(void) {
    if (!present) return;
    if (busy) {
        if (now_ms() - busy_since < 500) return;
        busy = false;                              // lost completion
    }
    if (ch_tail != ch_head) {                      // console challenge pages first
        xfer_buf[0] = RID_SET_CHALLENGE;
        memcpy(&xfer_buf[1], challenge[ch_tail], 63);
        if (tuh_hid_set_report(d_addr, d_inst, RID_SET_CHALLENGE, HID_REPORT_TYPE_FEATURE, xfer_buf, 64)) {
            busy = true; busy_since = now_ms();
            ch_tail = (uint8_t)((ch_tail + 1) & 7);
        }
        return;
    }
    if (want_resp) {
        memset(xfer_buf, 0, sizeof(xfer_buf));
        xfer_buf[0] = RID_GET_RESPONSE;
        if (tuh_hid_get_report(d_addr, d_inst, RID_GET_RESPONSE, HID_REPORT_TYPE_FEATURE, xfer_buf, 64)) {
            busy = true; busy_since = now_ms(); want_resp = false;
        }
        return;
    }
    if (!status_ready && now_ms() - last_status_poll >= 10) {   // keep the signing status fresh
        memset(xfer_buf, 0, 16);
        xfer_buf[0] = RID_GET_STATUS;
        if (tuh_hid_get_report(d_addr, d_inst, RID_GET_STATUS, HID_REPORT_TYPE_FEATURE, xfer_buf, 16)) {
            busy = true; busy_since = now_ms();
        }
        last_status_poll = now_ms();
    }
}

// ---- console
uint16_t ps5_dev_get_report(uint8_t report_id, uint8_t report_type, uint8_t *buffer, uint16_t reqlen) {
    if (report_type != HID_REPORT_TYPE_FEATURE) return 0;
    uint16_t n = 0;
    switch (report_id) {
        case RID_FEATURE:
            n = sizeof(feature_config) < reqlen ? sizeof(feature_config) : reqlen;
            memcpy(buffer, feature_config, n);
            return n;
        case RID_GET_STATUS:
            if (status_valid) {
                n = sizeof(status_cache) < reqlen ? sizeof(status_cache) : reqlen;
                memcpy(buffer, status_cache, n);
            } else {                                   // nothing from the dongle yet: "still signing"
                uint8_t d[16] = {RID_GET_STATUS, seq, 16};
                uint32_t crc = crc32(d, 12);
                memcpy(&d[12], &crc, 4);
                n = 15 < reqlen ? 15 : reqlen;
                memcpy(buffer, &d[1], n);
            }
            return n;
        case RID_GET_RESPONSE:
            if (!resp_valid) return 0;                  // not fetched yet: the console asks again
            n = sizeof(resp_cache) < reqlen ? sizeof(resp_cache) : reqlen;
            memcpy(buffer, resp_cache, n);
            resp_valid = false;
            want_resp = true;                          // fetch the next page
            return n;
        default:
            return 0;
    }
}

void ps5_dev_set_report(uint8_t report_id, uint8_t report_type, const uint8_t *buffer, uint16_t len) {
    if (report_type != HID_REPORT_TYPE_FEATURE || report_id != RID_SET_CHALLENGE || len < 2) return;
    uint8_t next = (uint8_t)((ch_head + 1) & 7);
    if (next == ch_tail) return;                   // full: the console resends on failure
    memset(challenge[ch_head], 0, 64);
    memcpy(challenge[ch_head], buffer, len < 63 ? len : 63);
    if (buffer[1] == 0) {                          // page 0 starts a new challenge
        seq = buffer[0];
        status_valid = status_ready = resp_valid = want_resp = false;
    }
    ch_head = next;
}

bool ps5_relay_report(const uint8_t *report, uint16_t len) {
    if (!present) return false;
    bool sent = false;
    if (in_new && tud_hid_n_ready(0)) {            // the signed copy of the previous report
        if (tud_hid_n_report(0, in_report[0], &in_report[1], PS5_REPORT_LEN - 1)) { in_new = false; sent = true; }
    }
    if (!out_pending && !in_new && tuh_hid_send_ready(d_addr, d_inst)) {
        if (tuh_hid_send_report(d_addr, d_inst, report[0], &report[1], (uint16_t)(len - 1))) out_pending = true;
    }
    return sent;
}
