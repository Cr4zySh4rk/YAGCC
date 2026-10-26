#include "host/ps4_auth.h"
#include "host/ps5_auth.h"
#include "tusb.h"
#include "pico/unique_id.h"
#include "usb_common.h"
#include "config.h"
#include <string.h>
#include "auto_detect.h"

uint8_t g_usb_mode = MODE_XINPUT;

// Modes that keep the WebUSB configuration interface. The console-facing modes (PS3, Wii, Switch,
// original Xbox) must look exactly like the real controller, so they don't get one.
bool mode_has_config(uint8_t mode) { return mode == MODE_XINPUT || mode == MODE_HID || mode == MODE_KEYBOARD || mode == MODE_AUTO; }
uint8_t xinput_subtype(void) { return g_cfg.xinput_type == XI_ROCK_BAND ? 0x06 : 0x07; }   // guitar / guitar alternate (GH)

// ================================================================ HID report descriptors
// PS3 Guitar Hero guitar: same report descriptor Santroller uses (27 byte input report).
static const uint8_t desc_hid_ps3_gh[] = {
    HID_USAGE_PAGE(HID_USAGE_PAGE_DESKTOP),
    HID_USAGE(HID_USAGE_DESKTOP_GAMEPAD),
    HID_COLLECTION(HID_COLLECTION_APPLICATION),
    HID_USAGE_PAGE(HID_USAGE_PAGE_BUTTON),
    HID_LOGICAL_MIN(0), HID_LOGICAL_MAX(1), HID_PHYSICAL_MIN(0), HID_PHYSICAL_MAX(1),
    HID_REPORT_COUNT(13), HID_REPORT_SIZE(1),
    HID_USAGE_MIN(0x01), HID_USAGE_MAX(13),
    HID_INPUT(HID_DATA | HID_VARIABLE | HID_ABSOLUTE),
    HID_REPORT_COUNT(3),
    HID_INPUT(HID_CONSTANT | HID_VARIABLE | HID_ABSOLUTE),
    HID_USAGE_PAGE(HID_USAGE_PAGE_DESKTOP),
    HID_USAGE(HID_USAGE_DESKTOP_HAT_SWITCH),
    HID_LOGICAL_MAX(7),
    HID_PHYSICAL_MAX_N(315, 2),
    HID_REPORT_COUNT(1), HID_REPORT_SIZE(4),
    HID_INPUT(HID_DATA | HID_VARIABLE | HID_ABSOLUTE),
    HID_REPORT_COUNT(1),
    HID_INPUT(HID_CONSTANT | HID_VARIABLE | HID_ABSOLUTE),
    HID_USAGE_PAGE(HID_USAGE_PAGE_DESKTOP),
    HID_LOGICAL_MAX_N(255, 2), HID_PHYSICAL_MAX_N(255, 2),
    HID_USAGE(HID_USAGE_DESKTOP_X), HID_USAGE(HID_USAGE_DESKTOP_Y),
    HID_USAGE(HID_USAGE_DESKTOP_Z), HID_USAGE(HID_USAGE_DESKTOP_RZ),
    HID_REPORT_COUNT(4), HID_REPORT_SIZE(8),
    HID_INPUT(HID_DATA | HID_VARIABLE | HID_ABSOLUTE),
    // 12 vendor "pressure" bytes
    HID_USAGE_PAGE_N(HID_USAGE_PAGE_VENDOR, 2),
    HID_USAGE(0x20), HID_USAGE(0x21), HID_USAGE(0x22), HID_USAGE(0x23),
    HID_USAGE(0x24), HID_USAGE(0x25), HID_USAGE(0x26), HID_USAGE(0x27),
    HID_USAGE(0x28), HID_USAGE(0x29), HID_USAGE(0x2A), HID_USAGE(0x2B),
    HID_REPORT_COUNT(0x0C),
    HID_LOGICAL_MIN(0x00), HID_LOGICAL_MAX_N(0xff, 2),
    HID_REPORT_SIZE(8),
    HID_INPUT(HID_DATA | HID_VARIABLE | HID_ABSOLUTE),
    // PS3 output + feature (handshake) reports
    HID_REPORT_SIZE(8),
    HID_USAGE_N(0x2621, 2),
    HID_REPORT_COUNT(8),
    HID_OUTPUT(HID_DATA | HID_VARIABLE | HID_ABSOLUTE),
    HID_USAGE_N(0x2621, 2),
    HID_REPORT_COUNT(32),
    HID_FEATURE(HID_DATA | HID_VARIABLE | HID_ABSOLUTE),
    // accelerometer words
    HID_USAGE(0x2C), HID_USAGE(0x2D), HID_USAGE(0x2E), HID_USAGE(0x2F),
    HID_REPORT_COUNT(4),
    HID_LOGICAL_MAX_N(0x3ff, 2), HID_PHYSICAL_MAX_N(0x3ff, 2),
    HID_REPORT_SIZE(16),
    HID_REPORT_COUNT(4),
    HID_INPUT(HID_DATA | HID_VARIABLE | HID_ABSOLUTE),
    HID_COLLECTION_END,
};

// Generic HID gamepad: 16 buttons, hat, X/Y/Z/Rz bytes (7 byte report, no report id).
static const uint8_t desc_hid_generic[] = {
    HID_USAGE_PAGE(HID_USAGE_PAGE_DESKTOP),
    HID_USAGE(HID_USAGE_DESKTOP_GAMEPAD),
    HID_COLLECTION(HID_COLLECTION_APPLICATION),
    HID_USAGE_PAGE(HID_USAGE_PAGE_BUTTON),
    HID_USAGE_MIN(1), HID_USAGE_MAX(16),
    HID_LOGICAL_MIN(0), HID_LOGICAL_MAX(1),
    HID_REPORT_SIZE(1), HID_REPORT_COUNT(16),
    HID_INPUT(HID_DATA | HID_VARIABLE | HID_ABSOLUTE),
    HID_USAGE_PAGE(HID_USAGE_PAGE_DESKTOP),
    HID_USAGE(HID_USAGE_DESKTOP_HAT_SWITCH),
    HID_LOGICAL_MIN(0), HID_LOGICAL_MAX(7),
    HID_PHYSICAL_MIN(0), HID_PHYSICAL_MAX_N(315, 2),
    HID_REPORT_SIZE(4), HID_REPORT_COUNT(1),
    HID_INPUT(HID_DATA | HID_VARIABLE | HID_ABSOLUTE | HID_NULL_STATE),
    HID_REPORT_COUNT(1),
    HID_INPUT(HID_CONSTANT | HID_VARIABLE | HID_ABSOLUTE),
    HID_USAGE(HID_USAGE_DESKTOP_X), HID_USAGE(HID_USAGE_DESKTOP_Y),
    HID_USAGE(HID_USAGE_DESKTOP_Z), HID_USAGE(HID_USAGE_DESKTOP_RZ),
    HID_LOGICAL_MIN(0), HID_LOGICAL_MAX_N(255, 2),
    HID_PHYSICAL_MIN(0), HID_PHYSICAL_MAX_N(255, 2),
    HID_REPORT_SIZE(8), HID_REPORT_COUNT(4),
    HID_INPUT(HID_DATA | HID_VARIABLE | HID_ABSOLUTE),
    HID_COLLECTION_END,
};

// Auto mode: the generic gamepad as report 1, plus the PS3 / PS4 / PS5 output and feature reports that make
// those consoles ask for them (Santroller's TUD_HID_REPORT_DESC_PS3_4_5, the same usages and sizes)
static const uint8_t desc_hid_auto[] = {
    HID_USAGE_PAGE(HID_USAGE_PAGE_DESKTOP),
    HID_USAGE(HID_USAGE_DESKTOP_GAMEPAD),
    HID_COLLECTION(HID_COLLECTION_APPLICATION),
    HID_REPORT_ID(1)
    HID_USAGE_PAGE(HID_USAGE_PAGE_BUTTON),
    HID_USAGE_MIN(1), HID_USAGE_MAX(16),
    HID_LOGICAL_MIN(0), HID_LOGICAL_MAX(1),
    HID_REPORT_SIZE(1), HID_REPORT_COUNT(16),
    HID_INPUT(HID_DATA | HID_VARIABLE | HID_ABSOLUTE),
    HID_USAGE_PAGE(HID_USAGE_PAGE_DESKTOP),
    HID_USAGE(HID_USAGE_DESKTOP_HAT_SWITCH),
    HID_LOGICAL_MIN(0), HID_LOGICAL_MAX(7),
    HID_PHYSICAL_MIN(0), HID_PHYSICAL_MAX_N(315, 2),
    HID_REPORT_SIZE(4), HID_REPORT_COUNT(1),
    HID_INPUT(HID_DATA | HID_VARIABLE | HID_ABSOLUTE | HID_NULL_STATE),
    HID_REPORT_COUNT(1),
    HID_INPUT(HID_CONSTANT | HID_VARIABLE | HID_ABSOLUTE),
    HID_USAGE(HID_USAGE_DESKTOP_X), HID_USAGE(HID_USAGE_DESKTOP_Y),
    HID_USAGE(HID_USAGE_DESKTOP_Z), HID_USAGE(HID_USAGE_DESKTOP_RZ),
    HID_LOGICAL_MIN(0), HID_LOGICAL_MAX_N(255, 2),
    HID_PHYSICAL_MIN(0), HID_PHYSICAL_MAX_N(255, 2),
    HID_REPORT_SIZE(8), HID_REPORT_COUNT(4),
    HID_INPUT(HID_DATA | HID_VARIABLE | HID_ABSOLUTE),
    HID_USAGE_PAGE_N(HID_USAGE_PAGE_VENDOR, 2),
    HID_USAGE_N(0x2621, 2), HID_REPORT_SIZE(8), HID_REPORT_COUNT(10),
    HID_OUTPUT(HID_DATA | HID_VARIABLE | HID_ABSOLUTE),
    HID_REPORT_ID(3)
    HID_USAGE_N(0x2821, 2), HID_REPORT_COUNT(47), HID_FEATURE(HID_DATA | HID_VARIABLE | HID_ABSOLUTE),
    HID_USAGE_N(0x2721, 2), HID_REPORT_COUNT(47), HID_FEATURE(HID_DATA | HID_VARIABLE | HID_ABSOLUTE),
    HID_USAGE_N(0x2821, 2), HID_REPORT_COUNT(47), HID_FEATURE(HID_DATA | HID_VARIABLE | HID_ABSOLUTE),
    HID_USAGE_N(0x2621, 2), HID_REPORT_COUNT(32), HID_FEATURE(HID_DATA | HID_VARIABLE | HID_ABSOLUTE),
    HID_COLLECTION_END,
};

// Switch: HORIPAD / POKKEN layout (what GP2040-CE uses): 16 buttons, hat, 4 axes, vendor byte
static const uint8_t desc_hid_switch[] = {
    0x05, 0x01, 0x09, 0x05, 0xA1, 0x01, 0x15, 0x00, 0x25, 0x01, 0x35, 0x00, 0x45, 0x01, 0x75, 0x01,
    0x95, 0x10, 0x05, 0x09, 0x19, 0x01, 0x29, 0x10, 0x81, 0x02, 0x05, 0x01, 0x25, 0x07, 0x46, 0x3B,
    0x01, 0x75, 0x04, 0x95, 0x01, 0x65, 0x14, 0x09, 0x39, 0x81, 0x42, 0x65, 0x00, 0x95, 0x01, 0x81,
    0x01, 0x26, 0xFF, 0x00, 0x46, 0xFF, 0x00, 0x09, 0x30, 0x09, 0x31, 0x09, 0x32, 0x09, 0x35, 0x75,
    0x08, 0x95, 0x04, 0x81, 0x02, 0x06, 0x00, 0xFF, 0x09, 0x20, 0x95, 0x01, 0x81, 0x02, 0x0A, 0x21,
    0x26, 0x95, 0x08, 0x91, 0x02, 0xC0,
};

// Boot-protocol keyboard (8 byte report: modifiers, reserved, 6 keys)
static const uint8_t desc_hid_keyboard[] = { TUD_HID_REPORT_DESC_KEYBOARD() };

static bool mode_is_ps3_layout(uint8_t m) { return IS_PS3_MODE(m) || m == MODE_WII_RB; }

uint8_t const *tud_hid_descriptor_report_cb(uint8_t instance) {
    if (g_usb_mode == MODE_AUTO) { auto_mark_hid_desc(); return desc_hid_auto; }
    if (g_usb_mode == MODE_PS4) { uint16_t n; return ps4_report_desc(&n); }
    if (g_usb_mode == MODE_PS5) { uint16_t n; return ps5_report_desc(&n); }
    (void)instance;
    if (mode_is_ps3_layout(g_usb_mode)) return desc_hid_ps3_gh;    // GH, RB and Wii RB share it
    if (g_usb_mode == MODE_SWITCH) return desc_hid_switch;
    if (g_usb_mode == MODE_KEYBOARD) return desc_hid_keyboard;
    return desc_hid_generic;
}

static uint16_t hid_report_desc_len(void) {
    if (g_usb_mode == MODE_AUTO) return sizeof(desc_hid_auto);
    if (g_usb_mode == MODE_PS4) { uint16_t n; ps4_report_desc(&n); return n; }
    if (g_usb_mode == MODE_PS5) { uint16_t n; ps5_report_desc(&n); return n; }
    if (mode_is_ps3_layout(g_usb_mode)) return sizeof(desc_hid_ps3_gh);
    if (g_usb_mode == MODE_SWITCH) return sizeof(desc_hid_switch);
    if (g_usb_mode == MODE_KEYBOARD) return sizeof(desc_hid_keyboard);
    return sizeof(desc_hid_generic);
}

// ================================================================ device descriptor
static tusb_desc_device_t desc_device;

const uint8_t *usb_hid_report_desc(uint16_t *len) {
    if (g_usb_mode == MODE_AUTO) { *len = sizeof(desc_hid_generic); return desc_hid_generic; }   // Bluetooth: plain gamepad
    *len = hid_report_desc_len();
    return tud_hid_descriptor_report_cb(0);
}

uint8_t const *tud_descriptor_device_cb(void);
void usb_mode_ids(uint16_t *vid, uint16_t *pid, uint16_t *version) {
    const tusb_desc_device_t *d = (const tusb_desc_device_t *)tud_descriptor_device_cb();
    *vid = d->idVendor; *pid = d->idProduct; *version = d->bcdDevice;
}

static uint8_t const *device_desc(void);
uint8_t const *tud_descriptor_device_cb(void) {
    if (g_usb_mode == MODE_AUTO) auto_mark_device_desc();
    return device_desc();
}
static uint8_t const *device_desc(void) {
    memset(&desc_device, 0, sizeof(desc_device));
    desc_device.bLength = sizeof(desc_device);
    desc_device.bDescriptorType = TUSB_DESC_DEVICE;
    desc_device.bcdUSB = mode_has_config(g_usb_mode) ? 0x0210 : 0x0200;   // >= 2.01 so hosts read the BOS
    desc_device.bDeviceClass = 0x00;       // per-interface (lets Windows treat it as composite)
    desc_device.bMaxPacketSize0 = CFG_TUD_ENDPOINT0_SIZE;
    desc_device.idVendor = YACC_VID;
    desc_device.idProduct = YACC_PID;
    desc_device.bcdDevice = 0x0100;
    desc_device.iManufacturer = 1;
    desc_device.iProduct = 2;
    desc_device.iSerialNumber = 3;
    desc_device.bNumConfigurations = 1;

    switch (g_usb_mode) {
        case MODE_PS3_GH: desc_device.idVendor = REDOCTANE_VID; desc_device.idProduct = PS3_GH_GUITAR_PID; break;
        case MODE_PS3_RB: desc_device.idVendor = REDOCTANE_VID; desc_device.idProduct = PS3_RB_GUITAR_PID; break;
        case MODE_WII_RB: desc_device.idVendor = HARMONIX_VID;  desc_device.idProduct = WII_RB_GUITAR_PID; break;
        case MODE_HID:      desc_device.idProduct = 0x0002; break;
        case MODE_AUTO:     desc_device.idProduct = YACC_AUTO_PID; break;
        case MODE_XINPUT:   desc_device.bcdDevice = g_xinput_wireless ? 0x0110 : 0x0101; break;   // each layout gets its own Windows descriptor / driver cache entry (0.38: a fresh one for the wired pad)
        case MODE_KEYBOARD: desc_device.idProduct = 0x0003; break;
        case MODE_SWITCH:
            desc_device.idVendor = HORI_VID; desc_device.idProduct = HORI_POKKEN_PID;
            desc_device.iSerialNumber = 0;
            break;
        case MODE_PS4:
            desc_device.idVendor = RAZER_VID; desc_device.idProduct = RAZER_PS4_PID;
            desc_device.iSerialNumber = 0;
            break;
        case MODE_PS5:   // the P5General's identity, as Santroller's PS5 instruments
            desc_device.idVendor = P5GENERAL_VID; desc_device.idProduct = P5GENERAL_PID;
            desc_device.iSerialNumber = 0;
            break;
        case MODE_XBONE:
            desc_device.bDeviceClass = 0xFF; desc_device.bDeviceSubClass = 0x47; desc_device.bDeviceProtocol = 0xD0;
            desc_device.idVendor = MADCATZ_VID; desc_device.idProduct = XBONE_GUITAR_PID; desc_device.bcdDevice = 0x0101;
            break;
        case MODE_OGXBOX:
            desc_device.bcdUSB = 0x0110;
            desc_device.idVendor = 0x045E; desc_device.idProduct = 0x0289; desc_device.bcdDevice = 0x0121;
            desc_device.iManufacturer = desc_device.iProduct = desc_device.iSerialNumber = 0;
            break;
        default: break;
    }
    return (uint8_t const *)&desc_device;
}

// ================================================================ configuration
#define XINPUT_IF_LEN   40
#define SECURITY_IF_LEN 15
#define HID_IF_LEN      32
#define CONFIG_IF_LEN   9

static uint8_t desc_config[9 + XINPUT_IF_LEN + CONFIG_IF_LEN + SECURITY_IF_LEN + 16];

uint8_t const *tud_descriptor_configuration_cb(uint8_t index) {
    (void)index;
    uint8_t *p = desc_config + 9;
    bool cfg = mode_has_config(g_usb_mode);
    uint8_t n_itf = 0;

    if (g_usb_mode == MODE_XINPUT && g_xinput_wireless) {
        // one controller slot of a 360 wireless receiver, as a genuine receiver describes it (Santroller)
        const uint8_t x[] = {
            9, TUSB_DESC_INTERFACE, ITF_PAD, 0, 2, 0xFF, 0x5D, 0x81, 0,
            20, 0x22, 0x00, 0x01, 0x13, EP_PAD_IN, 0x1D, 0x00, 0x17, 0x01, 0x02, 0x08, 0x13, EP_PAD_OUT, 0x0C, 0x00, 0x0C, 0x01, 0x02, 0x08,
            7, TUSB_DESC_ENDPOINT, EP_PAD_IN, TUSB_XFER_INTERRUPT, U16_TO_U8S_LE(0x20), 1,
            7, TUSB_DESC_ENDPOINT, EP_PAD_OUT, TUSB_XFER_INTERRUPT, U16_TO_U8S_LE(0x20), 8,
        };
        memcpy(p, x, sizeof(x)); p += sizeof(x); n_itf++;
    } else if (g_usb_mode == MODE_XINPUT) {
        const uint8_t x[] = {
            9, TUSB_DESC_INTERFACE, ITF_PAD, 0, 2, 0xFF, 0x5D, 0x01, 0,
            17, 0x21, 0x10, 0x01, xinput_subtype(), 0x25, EP_PAD_IN, 0x14, 0x03, 0x03, 0x03, 0x04, 0x13, EP_PAD_OUT, 0x08, 0x03, 0x03,
            7, TUSB_DESC_ENDPOINT, EP_PAD_IN, TUSB_XFER_INTERRUPT, U16_TO_U8S_LE(0x20), 1,
            7, TUSB_DESC_ENDPOINT, EP_PAD_OUT, TUSB_XFER_INTERRUPT, U16_TO_U8S_LE(0x20), 8,
        };
        memcpy(p, x, sizeof(x)); p += sizeof(x); n_itf++;
    } else if (g_usb_mode == MODE_OGXBOX) {
        const uint8_t x[] = {
            9, TUSB_DESC_INTERFACE, ITF_PAD, 0, 2, 0x58, 0x42, 0x00, 0,
            7, TUSB_DESC_ENDPOINT, EP_PAD_IN, TUSB_XFER_INTERRUPT, U16_TO_U8S_LE(32), 4,
            7, TUSB_DESC_ENDPOINT, EP_PAD_OUT, TUSB_XFER_INTERRUPT, U16_TO_U8S_LE(32), 4,
        };
        memcpy(p, x, sizeof(x)); p += sizeof(x); n_itf++;
    } else if (g_usb_mode == MODE_XBONE) {
        const uint8_t x[] = {
            9, TUSB_DESC_INTERFACE, ITF_PAD, 0, 2, 0xFF, 0x47, 0xD0, 0,
            7, TUSB_DESC_ENDPOINT, EP_PAD_IN, TUSB_XFER_INTERRUPT, U16_TO_U8S_LE(64), 1,
            7, TUSB_DESC_ENDPOINT, EP_PAD_OUT, TUSB_XFER_INTERRUPT, U16_TO_U8S_LE(64), 1,
        };
        memcpy(p, x, sizeof(x)); p += sizeof(x); n_itf++;
    } else if (g_usb_mode == MODE_KEYBOARD) {
        const uint8_t h[] = {TUD_HID_DESCRIPTOR(ITF_PAD, 0, HID_ITF_PROTOCOL_KEYBOARD, hid_report_desc_len(), EP_PAD_IN, 16, 1)};
        memcpy(p, h, sizeof(h)); p += sizeof(h); n_itf++;
    } else {
        const uint8_t h[] = {TUD_HID_INOUT_DESCRIPTOR(ITF_PAD, 0, HID_ITF_PROTOCOL_NONE, hid_report_desc_len(), EP_PAD_OUT, EP_PAD_IN, 64, 1)};
        memcpy(p, h, sizeof(h)); p += sizeof(h); n_itf++;
    }
    if (cfg) {
        const uint8_t c[] = {9, TUSB_DESC_INTERFACE, ITF_CONFIG, 0, 0, 0xFF, 0x00, 0x00, 4};
        memcpy(p, c, sizeof(c)); p += sizeof(c); n_itf++;
    }
    if (g_usb_mode == MODE_XINPUT || g_usb_mode == MODE_AUTO) {
        // Xbox 360 security interface: the console runs its XSM3 challenge through this (see usb_drivers.c)
        const uint8_t sec[] = {9, TUSB_DESC_INTERFACE, ITF_SECURITY, 0, 0, 0xFF, 0xFD, 0x13, 5,
                               6, 0x41, 0x00, 0x01, 0x01, 0x03};
        memcpy(p, sec, sizeof(sec)); p += sizeof(sec); n_itf++;
    }
    uint16_t total = (uint16_t)(p - desc_config);
    uint8_t attr = (g_usb_mode == MODE_SWITCH || g_usb_mode == MODE_PS4 || g_usb_mode == MODE_PS5) ? 0x80 : (uint8_t)(0x80 | TUSB_DESC_CONFIG_ATT_REMOTE_WAKEUP);
    uint8_t power = (g_usb_mode == MODE_SWITCH || g_usb_mode == MODE_PS4 || g_usb_mode == MODE_PS5 || g_usb_mode == MODE_XBONE) ? 0xFA : 50;
    uint8_t hdr[] = {9, TUSB_DESC_CONFIGURATION, U16_TO_U8S_LE(total), n_itf, 1, 0, attr, power};
    memcpy(desc_config, hdr, sizeof(hdr));
    return desc_config;
}

// ================================================================ BOS (WebUSB + MS OS 2.0)
// MS OS 2.0 set: config interface -> WinUSB (+ DeviceInterfaceGUID for the browser),
// and in XInput mode the Xbox 360 security interface -> WinUSB as well, so Windows shows no unknown device.
#define MS_OS_HDR_LEN  0x0A
#define MS_OS_CFG_LEN  0x08
#define MS_OS_FN_CFG   (0x08 + 0x14 + 0x84)
#define MS_OS_FN_SEC   (0x08 + 0x14)

static uint16_t ms_os_len(void) {
    return MS_OS_HDR_LEN + MS_OS_CFG_LEN + MS_OS_FN_CFG + ((g_usb_mode == MODE_XINPUT || g_usb_mode == MODE_AUTO) ? MS_OS_FN_SEC : 0) +
           ((g_usb_mode == MODE_XINPUT && g_xinput_wireless) ? MS_OS_FN_SEC : 0);
}

static uint8_t desc_bos[TUD_BOS_DESC_LEN + TUD_BOS_WEBUSB_DESC_LEN + TUD_BOS_MICROSOFT_OS_DESC_LEN];

uint8_t const *tud_descriptor_bos_cb(void) {
    if (!mode_has_config(g_usb_mode)) return NULL;
    const uint8_t b[] = {
        TUD_BOS_DESCRIPTOR(sizeof(desc_bos), 2),
        TUD_BOS_WEBUSB_DESCRIPTOR(VREQ_WEBUSB, 1),
        TUD_BOS_MS_OS_20_DESCRIPTOR(ms_os_len(), VREQ_MS_OS),
    };
    memcpy(desc_bos, b, sizeof(desc_bos));
    return desc_bos;
}

// Landing page: Chrome offers to open this when the controller is plugged in. Scheme 1 = https://
#define LANDING_URL "cr4zysh4rk.github.io/YAGCC/"
const uint8_t *yacc_webusb_url_desc(uint16_t *len) {
    static uint8_t d[3 + sizeof(LANDING_URL)];
    size_t n = sizeof(LANDING_URL) - 1;
    d[0] = (uint8_t)(3 + n);
    d[1] = 3;   // WEBUSB_URL
    d[2] = 1;   // https://
    memcpy(&d[3], LANDING_URL, n);
    *len = d[0];
    return d;
}

const uint8_t *yacc_ms_os_desc(uint16_t *len) {
    static uint8_t d[MS_OS_HDR_LEN + MS_OS_CFG_LEN + MS_OS_FN_CFG + 2 * MS_OS_FN_SEC];
    uint16_t total = ms_os_len();
    uint8_t *p = d;
    #define W16(v) do { *p++ = (uint8_t)((v) & 0xFF); *p++ = (uint8_t)(((v) >> 8) & 0xFF); } while (0)
    W16(0x000A); W16(0x0000);                              // set header
    *p++ = 0x00; *p++ = 0x00; *p++ = 0x03; *p++ = 0x06;    // Windows 8.1+
    W16(total);
    W16(0x0008); W16(0x0001); *p++ = 0; *p++ = 0; W16(total - MS_OS_HDR_LEN);                 // configuration subset
    W16(0x0008); W16(0x0002); *p++ = ITF_CONFIG; *p++ = 0; W16(MS_OS_FN_CFG);                  // function subset: config
    W16(0x0014); W16(0x0003);                                                                  // compatible id
    memcpy(p, "WINUSB\0\0", 8); p += 8;
    memset(p, 0, 8); p += 8;
    W16(0x0084); W16(0x0004); W16(0x0007); W16(0x002A);                                        // DeviceInterfaceGUIDs
    const char *name = "DeviceInterfaceGUIDs";
    for (int i = 0; i < 20; i++) { *p++ = (uint8_t)name[i]; *p++ = 0; }
    *p++ = 0; *p++ = 0;
    W16(0x0050);
    const char *guid = "{B7E2F0A1-4C3D-4E5F-9A6B-7C8D9E0F1A2B}";
    for (int i = 0; i < 38; i++) { *p++ = (uint8_t)guid[i]; *p++ = 0; }
    *p++ = 0; *p++ = 0;
    *p++ = 0; *p++ = 0;
    if (g_usb_mode == MODE_XINPUT || g_usb_mode == MODE_AUTO) {
        W16(0x0008); W16(0x0002); *p++ = ITF_SECURITY; *p++ = 0; W16(MS_OS_FN_SEC);           // function subset: security
        W16(0x0014); W16(0x0003);
        memcpy(p, "WINUSB\0\0", 8); p += 8;
        memset(p, 0, 8); p += 8;
    }
    if (g_usb_mode == MODE_XINPUT && g_xinput_wireless) {
        W16(0x0008); W16(0x0002); *p++ = ITF_PAD; *p++ = 0; W16(MS_OS_FN_SEC);                // function subset: the pad
        W16(0x0014); W16(0x0003);
        memcpy(p, "XUSB20\0\0", 8); p += 8;                                                     // xusb22's receiver slot driver
        memset(p, 0, 8); p += 8;
    }
    #undef W16
    *len = total;
    return d;
}

// Microsoft OS 1.0 extended compatible id (Auto mode): config and security interfaces -> WinUSB
const uint8_t *yacc_ms_os1_compat(uint16_t *len) {
    static uint8_t d[16 + 2 * 24];
    memset(d, 0, sizeof(d));
    d[0] = sizeof(d); d[4] = 0x00; d[5] = 0x01; d[6] = 0x04; d[8] = 2;     // length, version 1.00, index 4, 2 functions
    const uint8_t itf[2] = {ITF_CONFIG, ITF_SECURITY};
    for (int i = 0; i < 2; i++) {
        uint8_t *f = d + 16 + 24 * i;
        f[0] = itf[i]; f[1] = 0x01;
        memcpy(f + 2, "WINUSB", 6);
    }
    *len = sizeof(d);
    return d;
}

// ================================================================ strings
enum { STR_LANG = 0, STR_MANUF, STR_PRODUCT, STR_SERIAL, STR_CONFIG, STR_SECURITY };

static uint16_t desc_str[100];
static const char str_xb360_auth[] = "Xbox Security Method 3, Version 1.00, \xa9 2005 Microsoft Corporation. All rights reserved.";

uint16_t const *tud_descriptor_string_cb(uint8_t index, uint16_t langid) {
    (void)langid;
    const char *s = NULL;
    char serial[2 * PICO_UNIQUE_BOARD_ID_SIZE_BYTES + 1];
    uint8_t chr_count;

    if (g_usb_mode == MODE_AUTO) auto_mark_string(index);
    if (index == STR_LANG) {
        desc_str[1] = 0x0409;
        chr_count = 1;
    } else if (index == 0xEE && g_usb_mode == MODE_AUTO) {
        // Microsoft OS 1.0 string: "MSFT100" + vendor code. Windows and the Xbox One read it (the Xbox One reads
        // no other string), then ask for the compatible id with that vendor code
        static const char sig[] = "MSFT100";
        for (int i = 0; i < 7; i++) desc_str[1 + i] = (uint8_t)sig[i];
        desc_str[8] = VREQ_MS_OS1;
        chr_count = 8;
    } else {
        switch (index) {
            case STR_MANUF:
                s = g_usb_mode == MODE_PS3_GH ? "RedOctane"
                  : g_usb_mode == MODE_PS3_RB ? "Harmonix"
                  : g_usb_mode == MODE_WII_RB ? "Licensed by Nintendo of America "
                  : g_usb_mode == MODE_SWITCH ? "HORI CO.,LTD."
                  : g_usb_mode == MODE_XBONE  ? "Mad Catz" : "YAGCC";
                break;
            case STR_PRODUCT:
                s = g_usb_mode == MODE_PS3_GH ? "Guitar Hero3 for PlayStation (R) 3"
                  : g_usb_mode == MODE_PS3_RB ? "Harmonix Guitar for PlayStation(R)3"
                  : g_usb_mode == MODE_WII_RB ? "Harmonix Guitar for Nintendo Wii"
                  : g_usb_mode == MODE_SWITCH ? "POKKEN CONTROLLER"
                  : g_usb_mode == MODE_HID    ? "YAGCC Guitar (HID)"
                  : g_usb_mode == MODE_AUTO   ? "YAGCC Guitar"
                  : g_usb_mode == MODE_KEYBOARD ? "YAGCC Guitar (Keyboard)"
                  : g_usb_mode == MODE_PS4    ? "YAGCC Guitar (PS4)"
                  : g_usb_mode == MODE_PS5    ? "YAGCC Guitar (PS5)"
                  : g_usb_mode == MODE_XBONE  ? "Rock Band 4 Stratocaster"
                                              : "YAGCC Guitar Controller";
                break;
            case STR_SERIAL:
                pico_get_unique_board_id_string(serial, sizeof(serial));
                if (g_usb_mode == MODE_XINPUT) {
                    // Windows keys its driver bindings on VID/PID/serial: give the wired pad and the receiver slot
                    // their own serials, so one never inherits (or is blocked by) the other's driver record. The
                    // trailing firmware number is a salt too: bumping it makes every Windows PC bind the XInput layouts afresh.
                    static char ser2[2 * PICO_UNIQUE_BOARD_ID_SIZE_BYTES + 6];
                    size_t k = strlen(serial);
                    memcpy(ser2, serial, k);
                    ser2[k++] = '-'; ser2[k++] = g_xinput_wireless ? 'r' : 'w'; ser2[k++] = '3'; ser2[k++] = '9'; ser2[k] = 0;
                    s = ser2;
                } else s = serial;
                break;
            case STR_CONFIG:   s = "YAGCC Configuration"; break;
            case STR_SECURITY: s = str_xb360_auth; break;
            default: return NULL;
        }
        size_t n = strlen(s);
        chr_count = (uint8_t)(n > 98 ? 98 : n);
        for (uint8_t i = 0; i < chr_count; i++) desc_str[1 + i] = (uint8_t)s[i];
    }
    desc_str[0] = (uint16_t)((TUSB_DESC_STRING << 8) | (2 * chr_count + 2));
    return desc_str;
}
