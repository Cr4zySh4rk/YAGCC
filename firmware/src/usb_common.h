#ifndef YACC_USB_COMMON_H_
#define YACC_USB_COMMON_H_
#include <stdint.h>
#include <stdbool.h>
#include "tusb.h"

#define YACC_VID 0x1209   // pid.codes test VID/PID - change for your own builds
#define YACC_PID 0x0001
#define YACC_AUTO_PID 0x0004   // Auto mode, before the host is known (its own id, so no host caches it as another mode)

// Real-world identity used for the PS3 Guitar Hero guitar personality
#define REDOCTANE_VID    0x12BA
#define PS3_GH_GUITAR_PID 0x0100
#define PS3_RB_GUITAR_PID 0x0200   // Rock Band guitar (Santroller uses the same VID/PID)
#define HARMONIX_VID      0x1BAD
#define WII_RB_GUITAR_PID 0x0004
#define HORI_VID          0x0F0D
#define HORI_POKKEN_PID   0x0092
#define RAZER_VID         0x1532   // PS4 mode: same identity GP2040-CE uses
#define RAZER_PS4_PID     0x0401
#define MADCATZ_VID       0x0738   // Xbox One mode: Mad Catz, as Santroller's Xbox One guitars
#define XBONE_GUITAR_PID  0x02EA
#define IS_PS3_MODE(m) ((m) == MODE_PS3_GH || (m) == MODE_PS3_RB)

#define ITF_PAD    0      // XInput or HID interface
#define ITF_CONFIG 1      // WebUSB configuration interface (modes that have one)
#define ITF_SECURITY 2    // Xbox 360 security interface (XInput mode)

#define EP_PAD_IN  0x81
#define EP_PAD_OUT 0x02

// Vendor request codes (bRequest).
#define VREQ_XINPUT   0x01   // Xbox 360 GET_REPORT style requests (caps / serial)
#define VREQ_WEBUSB   0x21   // announced in the BOS descriptor
#define VREQ_MS_OS    0x22   // announced in the BOS descriptor
#define VREQ_MS_OS1   0x23   // Auto mode: vendor code in the Microsoft OS 1.0 string (0xEE)
#define VREQ_INFO     0x30   // IN  : device info
#define VREQ_STATUS   0x31   // IN  : live inputs
#define VREQ_GETCFG   0x32   // IN  : config struct
#define VREQ_SETCFG   0x33   // OUT : config struct (applied live, not saved)
#define VREQ_SAVE     0x34   // OUT : write config to flash
#define VREQ_DEFAULTS 0x35   // OUT : reset config to defaults (not saved)
#define VREQ_REBOOT   0x36   // OUT : wValue 0 = reboot, 1 = BOOTSEL
#define VREQ_SETMODE  0x37   // OUT : wValue = mode to store (applies after reboot)

#define VREQ_BTLOG    0x39   // IN  : Bluetooth event log (bt_log_read)
#define VREQ_BTLOGFL  0x3A   // IN  : Bluetooth log kept in flash (test builds), OUT: erase it
#define VREQ_RUMBLE   0x3B   // OUT : wValue = ms to run the rumble motor (test)
#define VREQ_LEDTEST  0x38   // OUT : wValue = chain position to light white, 0xFFFF = back to normal

#define XINPUT_REPORT_LEN 20
#define PS3_REPORT_LEN    27
#define HID_REPORT_LEN    7
#define KEYBOARD_REPORT_LEN 8
#define SWITCH_REPORT_LEN 8
#define OGXBOX_REPORT_LEN 20
#define PS4_GUITAR_REPORT_LEN 64

extern uint8_t g_usb_mode;         // MODE_* currently running
bool mode_has_config(uint8_t mode);
uint8_t xinput_subtype(void);
void usb_game_feedback(uint8_t command, uint8_t param);   // main.c: rumble-channel commands from games

void usb_request_setup_reboot(void);                                    // main.c
bool xinput_send(const uint8_t *report, uint16_t len);
bool usb_vendor_request(uint8_t rhport, uint8_t stage, tusb_control_request_t const *req);   // main.c
bool xinput_vendor_request(uint8_t rhport, uint8_t stage, tusb_control_request_t const *req);
const uint8_t *yacc_webusb_url_desc(uint16_t *len);
const uint8_t *yacc_ms_os_desc(uint16_t *len);
const uint8_t *yacc_ms_os1_compat(uint16_t *len);
// XInput host detection (main.c falls back to HID when no XInput driver uses the guitar)
extern volatile bool g_xinput_driver_seen;   // a host driver read a report, wrote the OUT endpoint or sent an XInput request
extern volatile bool g_host_windows;         // the host asked for the Microsoft OS 2.0 descriptor (only Windows does)
extern volatile bool g_config_seen;          // the web configurator talked to the guitar
// XInput as one controller slot of an Xbox 360 wireless receiver (Windows only): Steam's driver chokes on a wired
// XInput pad that shares its device with another interface, but takes a receiver (Santroller 5585c761)
extern volatile bool g_xinput_wireless;
#define XINPUT_WIRELESS_PACKET_SIZE 29
// The running mode's HID report descriptor (the generic gamepad for the XInput / Xbox modes) and USB ids,
// so Bluetooth can present the same device
const uint8_t *usb_hid_report_desc(uint16_t *len);
void usb_mode_ids(uint16_t *vid, uint16_t *pid, uint16_t *version);
#endif
