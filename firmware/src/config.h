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
    MODE_AUTO   = 10,  // detect the console / computer and restart in its mode (Santroller's detection)
    MODE_PS5    = 11,  // PS5 Rock Band guitar; auth and report signing by a P5General dongle on the host port
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
#define YACC_CFG_VERSION 7
#define YACC_CFG_V3_SIZE 64
#define YACC_CFG_V4_SIZE 96           // firmware 0.11 .. 0.28: no analog tilt sensors
#define YACC_CFG_V5_SIZE 128          // firmware 0.29 .. 0.30: one LED per fret
#define YACC_CFG_V6_SIZE 160          // firmware 0.31 .. 0.33: two LEDs per fret, tilt invert

// Analog tilt sensors (firmware 0.29+): up to two, each on its own analog input, each either adding to the
// whammy or pressing tilt / star power past a calibrated angle. They work alongside the whammy bar, the
// star power button and the digital tilt switch.
#define XOPT_NO_RECEIVER (1u << 0)   // XInput: never present as a wireless receiver slot on Windows
#define XOPT_WIIMOTE     (1u << 1)   // Pico W: act as a Wii Remote with a guitar extension over Bluetooth (classic)
#define RUMBLE_FLAG_GAME (1u << 0)   // follow the rumble games send
#define RUMBLE_FLAG_STAR (1u << 1)   // buzz when star power / overdrive starts (games that report it)
#define RUMBLE_FLAG_MISS (1u << 2)   // short buzz on a missed note (games that report it)   // XInput: never present as a wireless receiver slot on Windows

#define NUM_ATILT 2
enum { ATILT_WHAMMY = 0, ATILT_STAR = 1 };
// where a tilt sensor reads from: an analog input, or one axis of the I2C accelerometer
// (or one of a LIS3DH's three auxiliary ADC inputs, for analog sensors wired to the accelerometer board)
enum { ATILT_SRC_ADC0 = 0, ATILT_SRC_ADC1, ATILT_SRC_ADC2, ATILT_SRC_ACCEL_X, ATILT_SRC_ACCEL_Y, ATILT_SRC_ACCEL_Z,
       ATILT_SRC_LIS_ADC1, ATILT_SRC_LIS_ADC2, ATILT_SRC_LIS_ADC3, NUM_ATILT_SRC };
typedef struct __attribute__((packed)) {
    uint8_t  ch;          // ATILT_SRC_* or PIN_NONE = not fitted
    uint8_t  target;      // ATILT_*
    uint8_t  invert;      // 1 = the reading falls as the guitar tilts up
    uint8_t  threshold;   // star power: percent of the calibrated range where tilt presses (1..99)
    uint16_t min;         // 12-bit reading at one end of the calibration (accelerometer axes: 2048 = 0 g, 1024 per g)
    uint16_t max;         // the other end (min < max; `invert` says which end is the rest position)
} atilt_cfg_t;

#define NUM_LEDS 5          // frets with LEDs
#define MAX_FRET_LEDS (2 * NUM_LEDS)   // one or two LEDs under each fret (firmware 0.31)
#define MAX_STRUM_LEDS 8    // strum bar LEDs (one per side, the four corners, or four along each side)
#define MAX_LEDS (MAX_FRET_LEDS + MAX_STRUM_LEDS)   // longest chain: positions 0..17
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

// LED engine v2 (config version 7, firmware 0.34). Keep in sync with web/js/protocol.js
enum { IDLE_OFF = 0, IDLE_SOLID, IDLE_BREATHE, IDLE_HEARTBEAT, IDLE_RAINBOW, IDLE_RAINBOW_WAVE, IDLE_COLOR_WAVE,
       IDLE_SPARKLE, IDLE_CHASE, IDLE_FIRE, IDLE_HUE_DRIFT, NUM_IDLE };
enum { PRESS_NONE = 0, PRESS_COLOR, PRESS_FLASH_FADE, PRESS_DIM, PRESS_OFF, PRESS_STROBE, PRESS_RIPPLE,
       PRESS_RAINBOW, PRESS_SPARK, PRESS_SWEEP, NUM_PRESS };
enum { STAR_PULSE = 0, STAR_SOLID, STAR_RAINBOW, STAR_STROBE, STAR_CHASE, STAR_FIRE, STAR_SPARKLE, NUM_STAR };
enum { WFX_NONE = 0, WFX_BRIGHT, WFX_PULSE, WFX_HUE, WFX_WAVE, NUM_WFX };
#define ZF_SAME    (1u << 0)   // the pressed colour is the LED's idle colour
#define ZF_PER_LED (1u << 1)   // strum zone: each LED has its own idle colour
#define LEDF_FRET2_OWN   (1u << 0)   // a fret's second LED has its own idle colour (fret2_color)
#define LEDF_STAR_FLASH  (1u << 1)   // white flash when the player presses star power
typedef struct __attribute__((packed)) {
    uint8_t idle;         // IDLE_*
    uint8_t idle_level;   // 0..100 %
    uint8_t press;        // PRESS_*
    uint8_t speed;        // 1..10
    uint8_t fade;         // 1..10
    uint8_t zflags;       // ZF_*
    uint8_t rsv[2];
} led_zone_t;

// LED chip types
enum { LED_WS2812 = 0, LED_SK6812_RGBW = 1, LED_APA102 = 2, NUM_LED_TYPES };
// colour order on the wire for WS2812-style chips
enum { ORDER_GRB = 0, ORDER_RGB, ORDER_BRG, ORDER_RBG, ORDER_GBR, ORDER_BGR, NUM_ORDERS };
// XInput guitar flavour
enum { XI_GUITAR_HERO = 0, XI_ROCK_BAND = 1 };
// keyboard mode: key slots
enum { KEY_GREEN = 0, KEY_RED, KEY_YELLOW, KEY_BLUE, KEY_ORANGE, KEY_STRUM_UP, KEY_STRUM_DOWN,
       KEY_STAR, KEY_PLUS, KEY_TILT, KEY_WHAMMY, NUM_KEYS };

// 256 bytes on the wire and in flash (one flash page; 160 up to config version 6, 128 for v5, 96 for v4). Keep in sync with web/js/protocol.js
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
    uint8_t  led_order;           // 60      ORDER_* (WS2812; APA102 swaps the meaning of GRB and BGR, so 0 = its BGR)
    uint8_t  led_clk_pin;         // 61      APA102 clock GPIO or PIN_NONE
    uint8_t  keys[NUM_KEYS];      // 62..72  HID usage codes for keyboard mode (0 = none, 0xE0..E7 = modifiers)
    uint8_t  host_dp_pin;         // 73      USB host port D+ GPIO (D- is the next pin) or PIN_NONE
    // LED layout (bytes that used to be reserved, so zero = old behaviour: five fret LEDs, no strum LEDs)
    uint8_t  no_fret_leds;        // 74      1 = the chain has no fret LEDs (strum LEDs only)
    uint8_t  strum_leds;          // 75      number of strum bar LEDs, 0..MAX_STRUM_LEDS
    uint8_t  strum_map[4];        // 76..79  position in the chain of strum LEDs 1..4
    uint8_t  strum_color[3];      // 80..82  R,G,B of the strum LEDs (0,0,0 = white)
    uint8_t  strum_roles;         // 83      STRUM_ROLE_* of strum LEDs 1..4, 2 bits each (LED i at bits 2i..2i+1)
    uint8_t  strum_map2[4];       // 84..87  position in the chain of strum LEDs 5..8 (v0.26)
    uint8_t  strum_roles2;        // 88      roles of strum LEDs 5..8
    uint8_t  reserved[3];         // 89..91
    atilt_cfg_t atilt[NUM_ATILT]; // 92..107 analog tilt sensors (config version 5)
    uint8_t  accel_sda;           // 108     I2C accelerometer SDA GPIO (even) or PIN_NONE
    uint8_t  accel_scl;           // 109     SCL GPIO (the odd pin of the same I2C block)
    // accelerometer sample filters (Santroller's), each off at 0
    uint8_t  accel_gate;          // 110     drop samples more than this far from 1 g, in hundredths of g (0..100)
    uint8_t  accel_median;        // 111     median of this many samples (0 = off, 3..9)
    uint8_t  accel_lowpass;       // 112     2nd order Butterworth low pass cutoff in Hz (0 = off, 1..100)
    uint8_t  xinput_opts;         // 113     XOPT_* (firmware 0.30)
    uint8_t  rumble_pin;          // 114     vibration motor GPIO (PWM, through a transistor) or PIN_NONE
    uint8_t  rumble_flags;        // 115     RUMBLE_FLAG_*
    uint8_t  rumble_strength;     // 116     percent of full power at the strongest rumble (10..100)
    // PS2 controller port output (firmware 0.31): GPIOs wired to the port's ATT, CMD, DAT, CLK and ACK lines
    uint8_t  ps2_att;             // 117     PIN_NONE = off
    uint8_t  ps2_cmd;             // 118
    uint8_t  ps2_dat;             // 119
    uint8_t  ps2_clk;             // 120
    uint8_t  ps2_ack;             // 121
    // Wii extension output (firmware 0.31): I2C to a Wii Remote's extension port, the guitar acts as a
    // Guitar Hero guitar extension
    uint8_t  wii_sda;             // 122     PIN_NONE = off
    uint8_t  wii_scl;             // 123
    // config version 6 (firmware 0.31)
    uint8_t  fret_leds;           // 124     LEDs under each fret: 1 or 2
    uint8_t  led_map2[NUM_FRETS]; // 125..129 chain position of each fret's second LED (fret_leds = 2)
    uint8_t  tilt_invert;         // 130     1 = normally closed tilt switch: tilt is pressed while the switch is OPEN (0.33)
    uint8_t  reserved3[25];       // 131..155
    // config version 7 (firmware 0.34): LED engine v2
    led_zone_t zone_frets;        // 156..163
    led_zone_t zone_strum;        // 164..171
    uint8_t  fret_press[NUM_FRETS][3];   // 172..186 colour a pressed fret shows
    uint8_t  fret2_color[NUM_FRETS][3];  // 187..201 idle colour of each fret's second LED (LEDF_FRET2_OWN)
    uint8_t  strum_led_color[MAX_STRUM_LEDS][3]; // 202..225 idle colour of strum LED 1..8 (ZF_PER_LED)
    uint8_t  strum_up_color[3];   // 226..228
    uint8_t  strum_down_color[3]; // 229..231
    uint8_t  star_color[3];       // 232..234
    uint8_t  star_anim;           // 235     STAR_*
    uint8_t  star_zones;          // 236     bit0 frets, bit1 strum
    uint8_t  whammy_fx;           // 237     WFX_*
    uint8_t  whammy_zones;        // 238     bit0 frets, bit1 strum
    uint8_t  led_flags;           // 239     LEDF_*
    uint8_t  sleep_min;           // 240     0 = never, 1..30
    uint8_t  star_speed;          // 241     1..10
    uint8_t  reserved4[10];       // 242..251
    uint32_t crc;                 // 252     crc32 of bytes 0..251
} yacc_config_t;

#ifdef __cplusplus
static_assert(sizeof(yacc_config_t) == 256, "config size");
static_assert(sizeof(led_zone_t) == 8, "led zone size");
static_assert(sizeof(atilt_cfg_t) == 8, "analog tilt config size");
#else
_Static_assert(sizeof(yacc_config_t) == 256, "config size");
_Static_assert(sizeof(led_zone_t) == 8, "led zone size");
_Static_assert(sizeof(atilt_cfg_t) == 8, "analog tilt config size");
#endif

// Upgrade an older config (v4/v5/v6) to the current layout; false if src isn't a valid one
bool config_from_old(const uint8_t *src, uint16_t len, yacc_config_t *dst);   // a v4 (96), v5 (128) or v6 (160 byte) config

extern yacc_config_t g_cfg;

// Brightness ceiling for the LED layout, to keep the chain's current in check: 255 with the five fret LEDs
// only, 200 with strum LEDs only, 150 with fret and strum LEDs together
static inline uint8_t led_max_brightness(const yacc_config_t *c) {
    // Brightness ceiling for the LED layout, to keep the chain's current in check: 255 with five fret LEDs only,
    // 160 with two per fret, 200 with strum LEDs only, 150 with frets and strum LEDs, 110 with two per fret and strum
    bool two = c->fret_leds == 2 && !c->no_fret_leds;
    if (!c->strum_leds) return two ? 160 : 255;
    if (c->no_fret_leds) return 200;
    return two ? 110 : 150;
}

// strum LED i (0..MAX_STRUM_LEDS-1): chain position and role, across the two halves of the config
static inline uint8_t strum_led_pos(const yacc_config_t *c, int i) { return i < 4 ? c->strum_map[i] : c->strum_map2[i - 4]; }
static inline uint8_t strum_led_role(const yacc_config_t *c, int i) {
    return (uint8_t)(((i < 4 ? c->strum_roles : c->strum_roles2) >> (2 * (i & 3))) & 3);
}

void config_defaults(yacc_config_t *c);
void led_zones_from_efx(yacc_config_t *c);   // rgb_effect / rgb_speed -> both zones (old configurators)
void config_load(void);
bool config_save(void);
bool config_validate(const yacc_config_t *c);
void config_seal(yacc_config_t *c);   // fill magic/version/crc
void config_keyboard_preset(yacc_config_t *c, int preset);

#endif
