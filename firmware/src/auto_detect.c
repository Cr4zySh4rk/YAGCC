// Auto mode host detection, after Santroller's console detection (see auto_detect.h). While in Auto mode the
// guitar is a HID gamepad that also carries the PS3 / PS4 feature reports and an Xbox 360 security interface,
// and answers the Microsoft OS 1.0 and 2.0 descriptor requests, so that each host gives itself away:
//   Windows       reads the Microsoft OS descriptors and the string descriptors -> XInput
//   Xbox One      reads the Microsoft OS descriptors but never a string        -> Xbox One (or keyboard)
//   Xbox 360      starts the security handshake                                -> XInput
//   PS3 / RPCS3   asks for / sends a PS3 feature report                        -> PS3 guitar
//   PS4 / PS5     asks for feature report 0x03 (48 bytes)                      -> PS4 mode, or the PS3 Rock Band
//                                                                                 guitar Rock Band 4 takes natively
//   Switch        clears both endpoints; a Switch 2 reads the report descriptor -> Switch
//   original Xbox asks for the XID descriptor                                  -> OG Xbox
//   Wii / Wii U   configures the device, then goes quiet                       -> Wii Rock Band guitar
//   PS2           reads descriptors but never configures it                    -> PS3 guitar (what PS2 games and
//                                                                                 PADEMU take)
//   macOS, Linux, Android read strings and use it as it is: it stays the HID gamepad.
#include "auto_detect.h"
#include "device/usbd_pvt.h"
#include "class/hid/hid_device.h"
#include "pico/stdlib.h"

#define INFER_AFTER_MS 5000     // Santroller: 5 s after the first device descriptor read
#define WINDOWS_DECIDE_MS 1500  // Microsoft OS descriptors seen: strings follow within this on Windows

const char *const auto_host_names[NUM_HOSTS] = {
    "unknown", "Windows", "Xbox 360", "Xbox One", "PS3", "PS4 / PS5", "Switch", "Wii / Wii U", "PS2", "original Xbox",
};

static volatile uint32_t first_dev_ms, ms_os_ms;
static volatile bool string_read, ms_os_read, hid_desc_read, cleared_in, cleared_out;
static volatile uint8_t found;

static uint32_t ms_now(void) { uint32_t t = to_ms_since_boot(get_absolute_time()); return t ? t : 1; }

void auto_reset(void) {
    first_dev_ms = ms_os_ms = 0;
    string_read = ms_os_read = hid_desc_read = cleared_in = cleared_out = false;
}
void auto_mark_device_desc(void) { if (!first_dev_ms) first_dev_ms = ms_now(); }
void auto_mark_string(uint8_t index) {
    if (index == 0) return;                        // the language list doesn't count
    if (index == 0xEE) { auto_mark_ms_os(); return; }
    string_read = true;
}
void auto_mark_ms_os(void) { if (!ms_os_read) { ms_os_read = true; ms_os_ms = ms_now(); } }
void auto_mark_hid_desc(void) {
    hid_desc_read = true;
    // Santroller decides Windows / Xbox One here: Windows has read strings by the time it asks for this
    if (ms_os_read && !found) found = string_read ? HOST_WINDOWS : HOST_XBOXONE;
}
void auto_mark_clear_feature(uint8_t ep_addr) {
    if (tu_edpt_dir(ep_addr) == TUSB_DIR_IN) cleared_in = true; else cleared_out = true;
    if (cleared_in && cleared_out && !found) found = HOST_SWITCH;
}
void auto_found(uint8_t host) { if (!found && host < NUM_HOSTS) found = host; }

uint8_t auto_task(uint32_t now) {
    if (found) return found;
    if (ms_os_read && now - ms_os_ms > WINDOWS_DECIDE_MS) {
        found = string_read ? HOST_WINDOWS : HOST_XBOXONE;
        return found;
    }
    // hosts without a request of their own: decide from what they did and didn't read
    if (first_dev_ms && now - first_dev_ms > INFER_AFTER_MS && !ms_os_read && !string_read) {
        if (hid_desc_read) found = HOST_SWITCH;           // Switch 2
        else if (tud_mounted()) found = HOST_WII;         // the Wii and Wii U configure it, then stop
        else found = HOST_PS2;                            // the PS2 never configures it
    }
    return found;
}

// ---- HID class driver with a look at endpoint requests
static bool hid_control(uint8_t rhport, uint8_t stage, tusb_control_request_t const *req) {
    if (stage == CONTROL_STAGE_SETUP && req->bmRequestType_bit.recipient == TUSB_REQ_RCPT_ENDPOINT &&
        req->bmRequestType_bit.type == TUSB_REQ_TYPE_STANDARD && req->bRequest == TUSB_REQ_CLEAR_FEATURE) {
        auto_mark_clear_feature((uint8_t)req->wIndex);
    }
    return hidd_control_xfer_cb(rhport, stage, req);
}
static const usbd_class_driver_t drv = {
#if CFG_TUSB_DEBUG >= CFG_TUD_LOG_LEVEL
    .name = "AUTO-HID",
#endif
    .init = hidd_init,
    .deinit = hidd_deinit,
    .reset = hidd_reset,
    .open = hidd_open,
    .control_xfer_cb = hid_control,
    .xfer_cb = hidd_xfer_cb,
    .sof = NULL,
};
const usbd_class_driver_t *auto_hid_driver(void) { return &drv; }
