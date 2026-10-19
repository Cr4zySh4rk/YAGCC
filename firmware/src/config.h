// YAGCC persistent configuration (stored in the last flash sector)
#ifndef YACC_CONFIG_H_
#define YACC_CONFIG_H_

#include <stdint.h>
#include <stdbool.h>

// Logical controls. The web app maps each of these to a GPIO during setup.
enum {
    F_GREEN = 0,
    F_RED,
    F_YELLOW,
    F_BLUE,
    F_ORANGE,
    F_STRUM_UP,
    F_STRUM_DOWN,
    F_STAR,
    F_PLUS,
    NUM_FUNCS
};
#define NUM_FRETS 5

// USB personalities
enum {
    MODE_XINPUT = 0,   // Xbox 360 guitar (XInput) + WebUSB config
    MODE_PS3_GH = 1,   // PlayStation 3 Guitar Hero guitar (HID)
    MODE_HID    = 2,   // Generic HID gamepad + WebUSB config
    MODE_PS3_RB = 3,   // PlayStation 3 Rock Band guitar (HID), same identity Santroller uses
    MODE_KEYBOARD = 4, // USB keyboard (Fortnite Festival on PS4/PS5/Xbox without auth) + WebUSB config
    MODE_SWITCH = 5,   // Nintendo Switch (HORIPAD-compatible HID gamepad)
    MODE_WII_RB = 6,   // Wii Rock Band guitar (USB dongle identity, 1BAD:0004)
    MODE_OGXBOX = 7,   // Original Xbox controller (XID) - needs a USB-to-Xbox-port adapter
    MODE_PS4    = 8,   // PS4 Rock Band 4-style guitar; console auth relayed to a DS4 / dongle on the USB host port
    MODE_XBONE  = 9,   // Xbox One Rock Band 4-style guitar; auth relayed to an Xbox One/Series pad on the host port
    NUM_MODES
};
#define MODE_NONE 0xFF

#define PIN_NONE 0xFF

// Digital GPIOs that are scanned/usable for buttons (GP0..GP22).
// GP23-25 / GP29 are used by the board itself, GP26-28 are the analog inputs.
#define NUM_DIGITAL_PINS 23
#define NUM_ADC_CH       3

#define CFG_FLAG_BT_ENABLED     (1u << 0)
#define CFG_FLAG_TILT_ENABLED   (1u << 1)
#define CFG_FLAG_COMBINED_STRUM (1u << 2)   // strum up/down share one debounce window
#define CFG_FLAG_RGB_ENABLED    (1u << 3)   // WS2812 strip on rgb_pin
#define CFG_FLAG_RGB_BOOTFLASH  (1u << 4)   // flash the mode's fret LED for 1 s after plug-in
#define CFG_FLAG_STAR_DPAD_LEFT (1u << 5)   // XInput: star power also presses D-pad left (Fortnite Festival overdrive)
#define CFG_FLAG_RGB_STARPOWER  (1u << 6)   // light the frets when a game reports star power
#define CFG_FLAG_BT_DEBUG_LOG   (1u << 7)   // Bluetooth debug logging (Setup > Bluetooth): off unless switched on

// Debounce behaviour (same three flavours Santroller offers)
enum {
    DEB_RELEASE = 0,   // press instantly, hold the press for the debounce time after letting go
    DEB_PRESS   = 1,   // press only registers after being held for the debounce time, release is instant
    DEB_BOTH    = 2,   // classic: any change must be stable for the debounce time
};

#define YACC_CFG_MAGIC   0x43434159u  // "YAGCC" little endian
#define YACC_CFG_VERSION 4
#define YACC_CFG_V3_SIZE 64

#define NUM_LEDS 5          // fret LEDs
#define MAX_STRUM_LEDS 4    // strum bar LEDs (e.g. one per side, or the four corners)
#define MAX_LEDS (NUM_LEDS + MAX_STRUM_LEDS)   // longest chain: positions 0..8
// what a strum LED reacts to (2 bits per LED in strum_roles)
enum { STRUM_ROLE_BOTH = 0, STRUM_ROLE_UP = 1, STRUM_ROLE_DOWN = 2 };
// What the fret LEDs do
enum {
    EFX_STATIC = 0,   // always full colour
    EFX_DIM,          // full colour, dims while the fret is held
    EFX_OFF,          // full colour, goes dark while the fret is held
    EFX_BRIGHT,       // dim colour, lights up while the fret is held
    EFX_FADE,         // dim colour, flashes on press and fades back out
    EFX_BREATHE,      // breathing idle, full on press
    EFX_RAINBOW,      // rainbow idle, fret colour on press
    NUM_EFX
};

// LED chip types
enum { LED_WS2812 = 0, LED_SK6812_RGBW = 1, LED_APA102 = 2, NUM_LED_TYPES };
// colour order on the wire for WS2812-style chips
enum { ORDER_GRB = 0, ORDER_RGB, ORDER_BRG, ORDER_RBG, ORDER_GBR, ORDER_BGR, NUM_ORDERS };
// XInput guitar flavour
enum { XI_GUITAR_HERO = 0, XI_ROCK_BAND = 1 };
// keyboard mode: key slots
enum { KEY_GREEN = 0, KEY_RED, KEY_YELLOW, KEY_BLUE, KEY_ORANGE, KEY_STRUM_UP, KEY_STRUM_DOWN,
       KEY_STAR, KEY_PLUS, KEY_TILT, KEY_WHAMMY, NUM_KEYS };

// 96 bytes on the wire and in flash. Keep in sync with web/js/protocol.js
typedef struct __attribute__((packed)) {
    uint32_t magic;               // 0
    uint8_t  version;             // 4
    uint8_t  pins[NUM_FUNCS];     // 5..13   GPIO per function, PIN_NONE = unassigned
    uint8_t  whammy_ch;           // 14      0..2 (GP26..28) or PIN_NONE
    uint8_t  whammy_invert;       // 15
    uint16_t whammy_min;          // 16      raw 12-bit
    uint16_t whammy_max;          // 18
    uint8_t  tilt_pin;            // 20      GPIO or PIN_NONE
    uint8_t  flags;               // 21
    uint8_t  usb_mode;            // 22      mode used when nothing is held at plug-in
    uint8_t  debounce_mode;       // 23      DEB_*
    uint16_t debounce_100us;      // 24      debounce time in 100 us units
    uint8_t  whammy_smooth;       // 26      0 (off) .. 6 (heavy)
    uint8_t  whammy_deadzone;     // 27      percent of range
    uint8_t  boot_modes[NUM_FRETS]; // 28..32 mode to switch to when this fret is held at plug-in
    uint8_t  rgb_pin;             // 33      data GPIO of the WS2812 chain or PIN_NONE
    uint8_t  rgb_brightness;      // 34      0..255
    uint8_t  rgb_effect;          // 35      EFX_*
    uint8_t  rgb_speed;           // 36      1..10
    uint8_t  led_map[NUM_FRETS];  // 37..41  position in the chain of each fret's LED
    uint8_t  colors[NUM_FRETS][3];// 42..56  R,G,B of each fret
    uint8_t  cfg_rev;             // 57      bumped by in-place migrations (see config_load)
    uint8_t  xinput_type;         // 58      XI_GUITAR_HERO / XI_ROCK_BAND
    uint8_t  led_type;            // 59      LED_*
    uint8_t  led_order;           // 60      ORDER_* (WS2812 / SK6812)
    uint8_t  led_clk_pin;         // 61      APA102 clock GPIO or PIN_NONE
    uint8_t  keys[NUM_KEYS];      // 62..72  HID usage codes for keyboard mode (0 = none, 0xE0..E7 = modifiers)
    uint8_t  host_dp_pin;         // 73      USB host port D+ GPIO (D- is the next pin) or PIN_NONE
    // LED layout (bytes that used to be reserved, so zero = old behaviour: five fret LEDs, no strum LEDs)
    uint8_t  no_fret_leds;        // 74      1 = the chain has no fret LEDs (strum LEDs only)
    uint8_t  strum_leds;          // 75      number of strum bar LEDs, 0..MAX_STRUM_LEDS
    uint8_t  strum_map[MAX_STRUM_LEDS]; // 76..79 position in the chain of each strum LED
    uint8_t  strum_color[3];      // 80..82  R,G,B of the strum LEDs (0,0,0 = white)
    uint8_t  strum_roles;         // 83      STRUM_ROLE_* per strum LED, 2 bits each (LED i at bits 2i..2i+1)
    uint8_t  reserved[8];         // 84..91
    uint32_t crc;                 // 92      crc32 of bytes 0..91
} yacc_config_t;

_Static_assert(sizeof(yacc_config_t) == 96, "config size");

extern yacc_config_t g_cfg;

void config_defaults(yacc_config_t *c);
void config_load(void);
bool config_save(void);
bool config_validate(const yacc_config_t *c);
void config_seal(yacc_config_t *c);   // fill magic/version/crc
void config_keyboard_preset(yacc_config_t *c, int preset);

#endif
