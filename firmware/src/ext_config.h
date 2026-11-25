// YAGCC extension config page (firmware 0.42): extra inputs (D-pad, select, home, analog stick) and the per-mode
// input map. 512 bytes, stored in the two flash pages right after the main config page (same sector).
// Keep in sync with web/js/protocol.js and the spec in the repo notes.
#ifndef YACC_EXT_CONFIG_H_
#define YACC_EXT_CONFIG_H_

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include "config.h"
#include "dev_name.h"
#include "xled.h"

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
#define EXT_MAP_ROWS 12        // one per USB mode (MODE_* 0..11); MODE_X360 (12) uses the MODE_XINPUT row
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
    int8_t   curve[3];              // 320 whammy, 321 tilt sensor 1, 322 tilt sensor 2: response curve -100..+100 (0 = linear)
    uint8_t  range[4];              // 323 whammy, 324 tilt switch, 325 sensor 1, 326 sensor 2 (0.44): stick range, 0 = from centre, 1 = full sweep
    uint8_t  bt_sleep;              // 327    (0.45) Bluetooth idle sleep: 0 = 2 minutes (default), 1..60 minutes, 255 = never
    uint8_t  dev_name[DEVNAME_LEN]; // 328..353 (0.46 prefix of 10, 0.51 the whole name, up to 25) printable ASCII, NUL padded, empty = default names
    uint8_t  tilt_sw_type;          // 354    (0.51) tilt switch: 0 = mercury / generic, 1 = SW-520D ball switch
    uint8_t  tilt_sw_filter_ms;     // 355    (0.51) settle time: 0 = type default, 1..250 ms
    uint8_t  strum_guard;           // 356    (0.53) strum release guard: 0 = default (15 ms), 1..40 ms, 255 = off
    uint8_t  led_flags;             // 357    (0.54) LED_FLAG_*: bit0 = overdrive (no layout brightness ceiling); other bits must be 0
    uint8_t  xled_pin[3];           // 358..360 (0.56) data GPIO of extra LED chains 1..3, PIN_NONE = none (only checked while a zone uses the chain)
    xzone_t  xzone[NUM_XZONES];     // 361..400 (0.56) extra LED zones: neck, star, plus, body (see xled.h); all zeros = off
    uint8_t  xled_clk[3];           // 401..403 (0.56) clock GPIO of an APA102 / SK9822 extra chain, PIN_NONE otherwise
    uint8_t  xled_type[3];          // 404..406 (0.56) LED type of extra chains 1..3 (LED_* of the main config)
    uint8_t  xled_order[3];         // 407..409 (0.56) colour order of extra chains 1..3 (ORDER_*)
    uint8_t  strum_chain;           // 410    (0.57) chain the strum LEDs sit on: 0 = the main chain (default), 1..3 = extra chain (xled_pin / type / order / clk of that chain)
    uint8_t  rsv2[97];              // 411..507
    uint32_t crc;                   // 508    crc32 of bytes 0..507
} ext_config_t;
_Static_assert(sizeof(ext_config_t) == EXT_SIZE, "ext config size");
_Static_assert(offsetof(ext_config_t, map) == 32 && offsetof(ext_config_t, curve) == 320 && offsetof(ext_config_t, range) == 323 && offsetof(ext_config_t, bt_sleep) == 327 && offsetof(ext_config_t, dev_name) == 328 && offsetof(ext_config_t, tilt_sw_type) == 354 && offsetof(ext_config_t, tilt_sw_filter_ms) == 355 && offsetof(ext_config_t, strum_guard) == 356 && offsetof(ext_config_t, led_flags) == 357 && offsetof(ext_config_t, xled_pin) == 358 && offsetof(ext_config_t, xzone) == 361 && offsetof(ext_config_t, xled_clk) == 401 && offsetof(ext_config_t, xled_type) == 404 && offsetof(ext_config_t, xled_order) == 407 && offsetof(ext_config_t, strum_chain) == 410 && offsetof(ext_config_t, rsv2) == 411 && offsetof(ext_config_t, crc) == 508, "ext config layout");

extern ext_config_t g_ext;

#define LED_FLAG_OVERDRIVE 0x01
static inline bool led_flags_valid(uint8_t f) { return (f & (uint8_t)~LED_FLAG_OVERDRIVE) == 0; }
// Brightness ceiling in force: 255 with overdrive on, else the layout's led_max_brightness()
static inline uint8_t led_brightness_ceiling(const yacc_config_t *c, uint8_t led_flags) {
    return (led_flags & LED_FLAG_OVERDRIVE) ? 255 : led_max_brightness(c);
}

// LEDs the zones add (all chains), and the ceiling with them counted (0.56): see xled_ceiling()
static inline unsigned xled_total(const yacc_config_t *c, const ext_config_t *e) {
    unsigned t = (c->no_fret_leds ? 0u : 5u * (c->fret_leds == 2 ? 2u : 1u)) + c->strum_leds;
    for (int z = 0; z < NUM_XZONES; z++) t += e->xzone[z].count;
    return t;
}
static inline uint8_t led_brightness_ceiling_x(const yacc_config_t *c, const ext_config_t *e) {
    return xled_ceiling(led_max_brightness(c), xled_total(c, e), (e->led_flags & LED_FLAG_OVERDRIVE) != 0);
}
// some active zone sits on extra chain `chain` (1..3), i.e. xled_pin[chain-1] is in use
static inline bool xled_zone_chain_used(const ext_config_t *e, int chain) {
    for (int z = 0; z < NUM_XZONES; z++) if (e->xzone[z].count && e->xzone[z].chain == chain) return true;
    return false;
}
// a zone or (0.57) the strum LEDs use extra chain `chain` (the ext page alone cannot tell if there are any strum LEDs: strum_chain > 0 counts)
static inline bool xled_chain_used(const ext_config_t *e, int chain) {
    return xled_zone_chain_used(e, chain) || e->strum_chain == chain;
}

uint32_t yacc_crc32(const uint8_t *d, size_t n);   // the config crc (zlib crc32)
void ext_defaults(ext_config_t *e);                // sealed
void ext_seal(ext_config_t *e);                    // fill magic / version / crc
// magic, version, crc, pins valid and unique and not used by `main` (NULL = skip that check), ADC channels,
// deadzone, calibration (min < mid < max, <= 4095) and map values (0, 1..31, 0xFF), curves (-100..100), stick ranges (0/1), Bluetooth sleep (0, 1..60, 255), name (printable ASCII, 1..25), tilt switch type (0/1), settle time (0..250) and strum release guard (0, 1..40, 255), and the extra LED zones (0.56: counts, enums, positions, no overlap, pins / LED type / clock of the chains in use, no overlap with the fret / strum LEDs when `main` is given; 0.57: strum_chain 0..3, strum LED positions on that chain)
bool ext_validate(const ext_config_t *e, const yacc_config_t *main);
bool ext_pin_used_by_main(const yacc_config_t *c, uint8_t gpio);   // some other feature of the main config owns this GPIO

#endif
