// Auto mode: find out which console or computer the guitar is plugged into from how the host enumerates it,
// then restart in the matching mode. The rules are Santroller's (docs/reverse_engineering/console_detection.md
// and src/emulation/usb/hid_device.cpp / hid_gamepad_device.cpp in sanjay900/Santroller, GPL-3.0).
#ifndef YACC_AUTO_DETECT_H_
#define YACC_AUTO_DETECT_H_
#include <stdint.h>
#include <stdbool.h>
#include "tusb.h"
#include "device/usbd_pvt.h"

enum {
    HOST_UNKNOWN = 0,
    HOST_WINDOWS,      // read the Microsoft OS descriptors and the strings
    HOST_XBOX360,      // started the Xbox 360 security handshake
    HOST_XBOXONE,      // read the Microsoft OS descriptors, but no strings
    HOST_PS3,          // PS3 feature report (or RPCS3)
    HOST_PS4,          // PS4 / PS5 feature report 0x03 of 48 bytes
    HOST_SWITCH,       // cleared both endpoints (Switch), or read the report descriptor but no strings (Switch 2)
    HOST_WII,          // configured the device, then went quiet without reading the report descriptor
    HOST_PS2,          // read descriptors only, never configured the device
    HOST_OGXBOX,       // asked for the XID descriptor
    NUM_HOSTS
};
extern const char *const auto_host_names[NUM_HOSTS];

void auto_reset(void);                    // a new enumeration
void auto_mark_device_desc(void);         // GET_DESCRIPTOR(device)
void auto_mark_string(uint8_t index);     // GET_DESCRIPTOR(string)
void auto_mark_ms_os(void);               // Microsoft OS 1.0 / 2.0 descriptor read
void auto_mark_hid_desc(void);            // HID report descriptor read
void auto_mark_clear_feature(uint8_t ep_addr);
void auto_found(uint8_t host);            // a host specific request was seen
// Call from the main loop: the host found so far (HOST_UNKNOWN while still looking, or for macOS / Linux /
// Android, which stay on the HID gamepad)
uint8_t auto_task(uint32_t now_ms);

// The HID class driver, wrapped to see endpoint CLEAR_FEATURE requests (the Switch's tell)
const usbd_class_driver_t *auto_hid_driver(void);
#endif
