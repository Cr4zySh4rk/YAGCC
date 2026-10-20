#ifndef YACC_BT_H_
#define YACC_BT_H_
#include <stdint.h>
#include <stdbool.h>

#define BT_STATE_OFF        0   // radio off, or waiting for the bonded host
#define BT_STATE_PAIRING    1   // discoverable, accepting a new host
#define BT_STATE_CONNECTED  2

// enabled: Bluetooth switched on in the configurator. pair: forget this mode's hosts and pair a new one
// (Star power held at power-on). open_window: be discoverable for a minute without forgetting anyone
// (after switching modes, so a host can add the new mode). With neither enabled nor pair, the radio stays off.
// The Bluetooth device copies the running USB mode (g_usb_mode): same HID descriptor, reports and ids.
void bt_init(bool enabled, bool pair, bool open_window);
void bt_task(void);
void bt_start_pairing(void);
uint8_t bt_state(void);
bool bt_supported(void);
bool bt_running(void);
// The running mode's HID input report, exactly as USB sends it (without a leading report id)
void bt_send_report(const uint8_t *report, uint16_t len);
// A USB host is (not) using the guitar: Bluetooth drops its host and stops advertising while one is (bonds kept)
void bt_set_usb_active(bool active);
// Wii Remote emulation (config option XOPT_WIIMOTE, Bluetooth Classic): the guitar extension's 6 data bytes
bool bt_wiimote(void);
void bt_wii_report(const uint8_t *ext, uint8_t len);
// Pico W / Pico 2 W read USB power through the radio chip: 1 / 0, or -1 when unknown
int bt_vbus(void);
// Bluetooth event log (last 48 events, 8 bytes each: u32 ms, u8 code, u8 a, u16 b), oldest first
uint16_t bt_log_read(uint8_t *out, uint16_t max);
// Test builds (-DYACC_BT_LOG_FLASH=1): the log kept in flash, 16 byte records (u32 seq, u32 ms, u16 boot,
// u8 code, u8 a, u16 b, u16 pad); erased sectors read as 0xFF. len = 0 when the build doesn't keep one.
const uint8_t *bt_log_flash(uint16_t *len);
void bt_log_flash_clear(void);
#endif
