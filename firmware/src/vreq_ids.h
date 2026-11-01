#ifndef YACC_VREQ_IDS_H_
#define YACC_VREQ_IDS_H_
// Vendor request codes, split out of usb_common.h so host tests can use them without TinyUSB.
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
#define VREQ_LEDPREVIEW 0x3C   // OUT, no data: wValue bits 0..4 frets held, 5 strum up, 6 strum down, 7 star power, 8..15 whammy 0..255; wIndex 1 = preview on, 0 = off

#define VREQ_GETEXT   0x3D   // IN  : 512 byte ext config page (ext_config.h)
#define VREQ_SETEXT   0x3E   // OUT : 512 byte ext config page (validated, applied live, not saved; invalid: stall)
#endif
