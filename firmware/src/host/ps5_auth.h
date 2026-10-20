// PS5 guitar mode: a third-party PS5 instrument whose console authentication (and input report signing) is
// done by a Besavior P5General dongle (2B81:0101) on the USB host port. After Santroller
// (src/emulation/usb/ps5_device.cpp and src/devices/usb/host/hid/ps5_host.cpp, GPL-3.0).
#pragma once
#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

#define P5GENERAL_VID 0x2B81
#define P5GENERAL_PID 0x0101
#define PS5_REPORT_LEN 64        // report id 1 + 63 bytes

const uint8_t *ps5_report_desc(uint16_t *len);

// device side (TinyUSB HID callbacks, report id handled by TinyUSB)
uint16_t ps5_dev_get_report(uint8_t report_id, uint8_t report_type, uint8_t *buffer, uint16_t reqlen);
void ps5_dev_set_report(uint8_t report_id, uint8_t report_type, const uint8_t *buffer, uint16_t len);
// One input report per call: ours goes to the dongle, the dongle's signed copy goes to the console.
// Returns true when a report was handed to the console.
bool ps5_relay_report(const uint8_t *report, uint16_t len);

// host side
bool ps5_host_is_dongle(uint8_t dev_addr);
void ps5_host_mount(uint8_t dev_addr, uint8_t instance);
void ps5_host_unmount(uint8_t dev_addr);
void ps5_host_report(uint8_t dev_addr, uint8_t instance, const uint8_t *report, uint16_t len);
void ps5_host_set_report_complete(uint8_t dev_addr, uint8_t instance, uint8_t report_id, uint16_t len);
void ps5_host_get_report_complete(uint8_t dev_addr, uint8_t instance, uint8_t report_id, uint16_t len);
void ps5_auth_task(void);
bool ps5_dongle_present(void);

#ifdef __cplusplus
}
#endif
