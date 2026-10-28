// YAGCC extension config page (firmware 0.42): extra inputs (D-pad, select, home, analog stick) and the per-mode
// input map. 512 bytes, stored in the two flash pages right after the main config page (same sector).
// Keep in sync with web/js/protocol.js and the spec in the repo notes.
#ifndef YACC_EXT_CONFIG_H_
#define YACC_EXT_CONFIG_H_

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include "config.h"

#define EXT_MAGIC   0x54584559u   // "YEXT" little endian
#define EXT_VERSION 1
#define EXT_SIZE    512

// Physical sources, i.e. the position in a mode's map row
enum {
    SRC_GREEN = 0, SRC_RED, SRC_YELLOW, SRC_BLUE, SRC_ORANGE, SRC_STRUM_UP, SRC_STRUM_DOWN, SRC_STAR, SRC_PLUS,
    SRC_WHAMMY,        // 9, analog
    SRC_TILT_SW,       // 10
    SRC_TILT_S1,       // 11, analog
    SRC_TILT_S2,       // 12, analog
    SRC_DPAD_UP, SRC_DPAD_DOWN, SRC_DPAD_LEFT, SRC_DPAD_RIGHT,   // 13..16
    SRC_SELECT, SRC_HOME,                                         // 17, 18
    SRC_STICK_X, SRC_STICK_Y,                                     // 19, 20, analog
    SRC_STICK_CLICK,                                              // 21
    NUM_SRC
};
#define EXT_MAP_COLS 24        // bytes per mode row (22, 23 reserved = 0xFF)
#define EXT_MAP_ROWS 12        // one per USB mode (MODE_* 0..11)
#define NUM_EXT_PINS 7         // D-pad up/down/left/right, select, home, stick click

// Generic outputs (map values). 0xFF = mode default, 0 = nothing
enum {
    OUT_NONE = 0,
    OUT_A, OUT_B, OUT_X, OUT_Y, OUT_LB, OUT_RB, OUT_LT_BTN, OUT_RT_BTN, OUT_BACK, OUT_START, OUT_GUIDE, OUT_L3, OUT_R3,
    OUT_DUP, OUT_DDOWN, OUT_DLEFT, OUT_DRIGHT,                       // 14..17
    OUT_LX, OUT_LY, OUT_RX, OUT_RY, OUT_LT, OUT_RT,                   // 18..23 full axes
    OUT_LXM, OUT_LXP, OUT_LYM, OUT_LYP, OUT_RXM, OUT_RXP, OUT_RYM, OUT_RYP,   // 24..31 half axes
    NUM_OUT
};
#define MAP_DEFAULT 0xFF

#define STICK_INVERT_X (1u << 0)
#define STICK_INVERT_Y (1u << 1)
#define STICK_SWAP     (1u << 2)

typedef struct __attribute__((packed)) {
    uint32_t magic;                 // 0
    uint8_t  version;               // 4
    uint8_t  rsv0[3];               // 5..7
    uint8_t  pin_ext[NUM_EXT_PINS]; // 8..14  D-pad up, down, left, right, select, home, stick click (GPIO or PIN_NONE)
    uint8_t  rsv1;                  // 15     0xFF
    uint8_t  stick_x_ch;            // 16     ADC channel 0..2 or PIN_NONE
    uint8_t  stick_y_ch;            // 17
    uint8_t  stick_flags;           // 18     STICK_*
    uint8_t  stick_deadzone;        // 19     0..50 %
    uint16_t x_min, x_mid, x_max;   // 20..25 raw 12-bit calibration of the X channel
    uint16_t y_min, y_mid, y_max;   // 26..31
    uint8_t  map[EXT_MAP_ROWS][EXT_MAP_COLS];   // 32..319
    uint8_t  rsv2[188];             // 320..507
    uint32_t crc;                   // 508    crc32 of bytes 0..507
} ext_config_t;
_Static_assert(sizeof(ext_config_t) == EXT_SIZE, "ext config size");
_Static_assert(offsetof(ext_config_t, map) == 32 && offsetof(ext_config_t, crc) == 508, "ext config layout");

extern ext_config_t g_ext;

uint32_t yacc_crc32(const uint8_t *d, size_t n);   // the config crc (zlib crc32)
void ext_defaults(ext_config_t *e);                // sealed
void ext_seal(ext_config_t *e);                    // fill magic / version / crc
// magic, version, crc, pins valid and unique and not used by `main` (NULL = skip that check), ADC channels,
// deadzone, calibration (min < mid < max, <= 4095) and map values (0, 1..31, 0xFF)
bool ext_validate(const ext_config_t *e, const yacc_config_t *main);
bool ext_pin_used_by_main(const yacc_config_t *c, uint8_t gpio);   // some other feature of the main config owns this GPIO

#endif
