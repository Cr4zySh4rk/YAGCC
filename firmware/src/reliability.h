#ifndef YACC_RELIABILITY_H_
#define YACC_RELIABILITY_H_
// Reset reasons, vendor request shape checks and the watchdog scratch layout. The decisions are pure (no SDK), so
// tests/host_map tests them; reliability.c holds the hardware side (watchdog, HardFault handler, stack canary).
#include <stdint.h>
#include <stdbool.h>
#include "vreq_ids.h"

// Why the last boot happened (status report byte 77)
enum {
    RR_POWER = 0,      // power on / USB plugged in / unknown
    RR_WATCHDOG = 1,   // the main loop stopped feeding the watchdog
    RR_HARDFAULT = 2,  // CPU HardFault
    RR_STACK = 3,      // stack canary overwritten
    RR_REBOOT = 4,     // the firmware asked for it (mode change, configurator, Auto mode, wake from sleep)
    RR_BT_INIT = 5,    // the watchdog fired while the radio was starting
};

// scratch[2]: bits 31..16 magic, 15..8 consecutive unclean resets, 7..0 phase/fault code. scratch[3]: faulting PC.
#define REL_MAGIC 0x5952u          // "YR"
#define REL_CODE_NONE 0
#define REL_CODE_HARDFAULT 1
#define REL_CODE_STACK 2
#define REL_CODE_BTINIT 0x10       // set while the radio starts: a reset in this window means the radio hung
#define REL_BT_SKIP_AFTER 3        // this many unclean resets in a row: boot without Bluetooth so USB works

static inline uint32_t rel_pack(uint8_t count, uint8_t code) { return ((uint32_t)REL_MAGIC << 16) | ((uint32_t)count << 8) | code; }
static inline bool rel_magic_ok(uint32_t s2) { return (s2 >> 16) == REL_MAGIC; }

// wd_reason: the chip reports a watchdog reset; enable_timeout: it was the armed timer, not watchdog_reboot()
static inline uint8_t rel_decode(bool wd_reason, bool enable_timeout, uint32_t s2) {
    if (!wd_reason) return RR_POWER;
    if (rel_magic_ok(s2)) {
        switch (s2 & 0xFF) {
            case REL_CODE_HARDFAULT: return RR_HARDFAULT;
            case REL_CODE_STACK: return RR_STACK;
            case REL_CODE_BTINIT: return RR_BT_INIT;
            default: break;
        }
    }
    return enable_timeout ? RR_WATCHDOG : RR_REBOOT;
}
static inline bool rel_unclean(uint8_t r) { return r == RR_WATCHDOG || r == RR_HARDFAULT || r == RR_STACK || r == RR_BT_INIT; }
// consecutive unclean resets, saturating
static inline uint8_t rel_count_next(uint8_t reason, uint32_t s2) {
    if (!rel_unclean(reason)) return 0;
    uint8_t c = rel_magic_ok(s2) ? (uint8_t)((s2 >> 8) & 0xFF) : 0;
    return c < 255 ? (uint8_t)(c + 1) : c;
}
static inline bool rel_skip_bt(uint8_t reason, uint8_t count) { (void)count; return reason == RR_BT_INIT; }   // 0.48: only right after a radio hang at start-up, for one boot

// Control request shape: direction and length a vendor request must have. A request with the wrong direction would
// make TinyUSB write host data into the buffer a GET handler points at (g_cfg, tx_buf ...), so those are stalled.
static inline bool vreq_shape_ok(uint8_t req, bool dir_in, uint16_t wlen) {
    switch (req) {
        case VREQ_WEBUSB: case VREQ_MS_OS:
        case VREQ_INFO: case VREQ_STATUS: case VREQ_GETCFG: case VREQ_GETEXT: case VREQ_BTLOG:
            return dir_in;
        case VREQ_BTLOGFL:                                  // IN: read the log, OUT: erase it
            return dir_in || wlen == 0;
        case VREQ_SETCFG: case VREQ_SETEXT:
            return !dir_in && wlen != 0;
        case VREQ_SAVE: case VREQ_DEFAULTS: case VREQ_REBOOT: case VREQ_SETMODE:
        case VREQ_RUMBLE: case VREQ_LEDTEST: case VREQ_LEDPREVIEW:
            return !dir_in && wlen == 0;
        default:
            return false;
    }
}

#ifndef YACC_HOST_TEST
extern uint8_t g_reset_reason;     // RR_*
extern uint8_t g_reset_count;      // consecutive unclean resets including this one
extern uint32_t g_reset_pc;        // PC of the last HardFault (0 if none)
void rel_init(void);               // first thing in main(): decode why we booted, arm the watchdog
void rel_arm(void);                // normal-operation watchdog timeout (after the slow start-up)
void rel_bt_phase(bool starting);  // wrap bt_init: a reset while starting skips Bluetooth next boot
void rel_task(void);               // main loop: feed the watchdog, check the stack canary
void rel_disarm(void);             // before BOOTSEL / deep sleep
void rel_bootsel(void);            // disarm + reset_usb_boot
void rel_fill_status(uint8_t *p);  // 77: reason, 78: count, 79..82: PC
#endif
#endif
