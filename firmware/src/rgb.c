// Fret and strum bar lighting: WS2812 / SK6812 (RGBW) over PIO or APA102 (data + clock), per-fret colour,
// remappable chain order, press-reactive effects, brightness, a boot-time mode indicator and
// star power glow when a game reports it. One chain of up to 9 LEDs: the five fret LEDs (optional) and up
// to eight strum bar LEDs (one per side, the four corners, or four along each side), in any order along the chain.
#include "rgb.h"
#include <string.h>
#include "pico/stdlib.h"
#include "hardware/pio.h"
#include "hardware/gpio.h"
#include "config.h"
#include "input.h"
#include "ws2812.pio.h"
#include <math.h>

#define FRAME_US    8000u
#define BOOT_FLASH_US 1000000u
#define BLINK_US    125000u
#define TEST_HOLD_US 2500000u

static PIO rgb_pio = pio0;
static const uint rgb_sm = 0;
static uint rgb_offset;
static bool program_loaded;
static int cur_pin = -1, cur_clk = -1, cur_type = -1;
static volatile bool star_power;
static volatile bool charging;
static volatile uint8_t bt_led;
static volatile uint32_t bt_connected_at;

void rgb_set_star_power(bool on) { star_power = on; }
void rgb_set_charging(bool on) { charging = on; }
void rgb_set_bt(uint8_t state) {
    if (state == RGB_BT_CONNECTED && bt_led != RGB_BT_CONNECTED) bt_connected_at = time_us_32() | 1;
    bt_led = state;
}
#define BT_CONNECTED_SHOW_US 1000000u

#define CHARGE_SWEEP_US 2000000u   // orange -> green
#define CHARGE_PAUSE_US  700000u   // dark gap before the next sweep

static uint32_t last_frame, boot_t0;
static int boot_fret = -1;
static int test_led = -1;
static uint32_t test_until;
static uint8_t fade[MAX_LEDS];        // per light (frets 0..4, strum LEDs 5..12)

// WS2812s are linear: a screen colour like #EF4444 (a clear red on a monitor) comes out pink and
// #FB923C (orange) comes out a washed-out peach, because the "small" channels are still far too bright.
// A gamma 2.6 curve maps the picked colour to what the eye expects from the LED.
static uint8_t gamma8[256];

void rgb_init(void) {
    for (int i = 0; i < 256; i++) gamma8[i] = (uint8_t)(powf(i / 255.0f, 2.6f) * 255.0f + 0.5f);
    pio_sm_claim(rgb_pio, rgb_sm);           // so the CYW43 radio driver (Pico W) never takes this state machine
    rgb_offset = pio_add_program(rgb_pio, &ws2812_program);
    program_loaded = true;
    last_frame = time_us_32();
}

static void release(int pin) {
    if (pin < 0) return;
    gpio_init(pin);
    gpio_set_dir(pin, GPIO_IN);
    gpio_pull_up(pin);
}

static void attach(int pin, int clk, int type) {
    if (pin == cur_pin && clk == cur_clk && type == cur_type) return;
    if (cur_pin >= 0 && cur_type != LED_APA102) pio_sm_set_enabled(rgb_pio, rgb_sm, false);
    release(cur_pin);
    release(cur_clk);
    cur_pin = cur_clk = cur_type = -1;
    if (pin < 0) return;
    if (type == LED_APA102) {
        if (clk < 0) return;
        gpio_init(pin); gpio_set_dir(pin, GPIO_OUT); gpio_put(pin, 0);
        gpio_init(clk); gpio_set_dir(clk, GPIO_OUT); gpio_put(clk, 0);
        cur_clk = clk;
    } else {
        ws2812_program_init(rgb_pio, rgb_sm, rgb_offset, (uint)pin, 800000.0f, type == LED_SK6812_RGBW ? 32 : 24);
    }
    cur_pin = pin;
    cur_type = type;
}

bool rgb_active_pin(int p) { return (cur_pin >= 0 && p == cur_pin) || (cur_clk >= 0 && p == cur_clk); }

void rgb_boot_indicator(uint8_t mode) {
    boot_t0 = time_us_32();
    boot_fret = -1;
    for (int f = 0; f < NUM_FRETS; f++) if (g_cfg.boot_modes[f] == mode) { boot_fret = f; break; }
    if (boot_fret < 0) boot_fret = (mode == MODE_PS3_GH) ? F_BLUE : (mode == MODE_PS3_RB) ? F_RED : (mode == MODE_HID) ? F_YELLOW
                                 : (mode == MODE_SWITCH) ? F_ORANGE : F_GREEN;
}

void rgb_test_led(int led) {
    test_led = led;
    test_until = time_us_32() + TEST_HOLD_US;
}

static void hsv(uint8_t h, uint8_t *r, uint8_t *g, uint8_t *b) {
    uint8_t region = h / 43, rem = (h - region * 43) * 6;
    uint8_t q = 255 - rem, t = rem;
    switch (region) {
        case 0: *r = 255; *g = t; *b = 0; break;
        case 1: *r = q; *g = 255; *b = 0; break;
        case 2: *r = 0; *g = 255; *b = t; break;
        case 3: *r = 0; *g = q; *b = 255; break;
        case 4: *r = t; *g = 0; *b = 255; break;
        default: *r = 255; *g = 0; *b = q; break;
    }
}

typedef struct { uint8_t r, g, b; } px_t;

static px_t pack(uint8_t r, uint8_t g, uint8_t b, uint8_t level, uint8_t bright) {
    uint32_t k = (uint32_t)level * bright;                  // 0 .. 255*255
    px_t p = { (uint8_t)((uint32_t)gamma8[r] * k / (255u * 255u)),
               (uint8_t)((uint32_t)gamma8[g] * k / (255u * 255u)),
               (uint8_t)((uint32_t)gamma8[b] * k / (255u * 255u)) };
    return p;
}

static void apa102_byte(uint8_t v) {
    for (int i = 7; i >= 0; i--) {
        gpio_put(cur_pin, (v >> i) & 1);
        gpio_put(cur_clk, 1);
        gpio_put(cur_clk, 0);
    }
}

static void output(const px_t *px, int n) {
    if (cur_type == LED_APA102) {
        for (int i = 0; i < 4; i++) apa102_byte(0x00);                    // start frame
        for (int i = 0; i < n; i++) {
            apa102_byte(0xFF);                                            // full global brightness (scaled in colour)
            apa102_byte(px[i].b); apa102_byte(px[i].g); apa102_byte(px[i].r);
        }
        for (int i = 0; i < 4; i++) apa102_byte(0xFF);                    // end frame
        return;
    }
    for (int i = 0; i < n; i++) {
        uint8_t r = px[i].r, g = px[i].g, b = px[i].b;
        if (cur_type == LED_SK6812_RGBW) {
            uint8_t w = r < g ? (r < b ? r : b) : (g < b ? g : b);        // move the shared white into W
            uint32_t word = ((uint32_t)(g - w) << 24) | ((uint32_t)(r - w) << 16) | ((uint32_t)(b - w) << 8) | w;
            pio_sm_put_blocking(rgb_pio, rgb_sm, word);
            continue;
        }
        uint8_t c[3];
        switch (g_cfg.led_order) {
            case ORDER_RGB: c[0] = r; c[1] = g; c[2] = b; break;
            case ORDER_BRG: c[0] = b; c[1] = r; c[2] = g; break;
            case ORDER_RBG: c[0] = r; c[1] = b; c[2] = g; break;
            case ORDER_GBR: c[0] = g; c[1] = b; c[2] = r; break;
            case ORDER_BGR: c[0] = b; c[1] = g; c[2] = r; break;
            default:        c[0] = g; c[1] = r; c[2] = b; break;          // GRB (WS2812B)
        }
        pio_sm_put_blocking(rgb_pio, rgb_sm, (((uint32_t)c[0] << 16) | ((uint32_t)c[1] << 8) | c[2]) << 8);
    }
}

// one shared (not inlined) colour path keeps rgb_task small
static void __attribute__((noinline)) set_px(px_t *px, uint8_t pos, uint8_t r, uint8_t g, uint8_t b, uint8_t level, uint8_t bright) {
    if (pos < MAX_LEDS) px[pos] = pack(r, g, b, level, bright);
}

// One light in the chain: a fret LED or a strum LED
typedef struct {
    uint8_t pos;            // position in the chain
    uint8_t r, g, b;        // its colour
    uint8_t idx;            // 0..4 fret, 5..8 strum LED (effect state and phase)
    int8_t  fret;           // the fret it sits under, -1 for a strum LED
    bool    down;           // its button is held (the fret, or the strum direction it follows)
} light_t;

static int build_lights(light_t *l, int *chain) {
    int n = 0, len = 0;
    if (!g_cfg.no_fret_leds)
        for (int f = 0; f < NUM_FRETS; f++)
            l[n++] = (light_t){ g_cfg.led_map[f], g_cfg.colors[f][0], g_cfg.colors[f][1], g_cfg.colors[f][2],
                                (uint8_t)f, (int8_t)f, input_func(f) };
    bool white = !g_cfg.strum_color[0] && !g_cfg.strum_color[1] && !g_cfg.strum_color[2];
    bool up = input_func(F_STRUM_UP), dn = input_func(F_STRUM_DOWN);
    for (int i = 0; i < g_cfg.strum_leds && i < MAX_STRUM_LEDS; i++) {
        uint8_t role = strum_led_role(&g_cfg, i);
        bool down = role == STRUM_ROLE_UP ? up : role == STRUM_ROLE_DOWN ? dn : (up || dn);
        l[n++] = (light_t){ strum_led_pos(&g_cfg, i), white ? 255 : g_cfg.strum_color[0], white ? 255 : g_cfg.strum_color[1],
                            white ? 255 : g_cfg.strum_color[2], (uint8_t)(NUM_FRETS + i), -1, down };
    }
    for (int k = 0; k < n; k++) if (l[k].pos < MAX_LEDS && l[k].pos + 1 > len) len = l[k].pos + 1;
    *chain = len;
    return n;
}

void rgb_task(void) {
    bool enabled = (g_cfg.flags & CFG_FLAG_RGB_ENABLED) && g_cfg.rgb_pin < NUM_DIGITAL_PINS;
    if (!program_loaded) return;
    int clk = (g_cfg.led_type == LED_APA102 && g_cfg.led_clk_pin < NUM_DIGITAL_PINS) ? (int)g_cfg.led_clk_pin : -1;
    attach(enabled ? (int)g_cfg.rgb_pin : -1, clk, g_cfg.led_type);
    if (!enabled || cur_pin < 0) return;

    uint32_t now = time_us_32();
    if ((uint32_t)(now - last_frame) < FRAME_US) return;
    last_frame = now;

    uint8_t bright = g_cfg.rgb_brightness;                  // 0..255
    light_t L[MAX_LEDS];
    int chain;
    int n = build_lights(L, &chain);
    px_t px[MAX_LEDS];
    memset(px, 0, sizeof(px));
#define SET(k, rr, gg, bb, lv) set_px(px, L[k].pos, (rr), (gg), (bb), (lv), bright)
    bool sp = star_power && (g_cfg.flags & CFG_FLAG_RGB_STARPOWER);
    bool testing = test_led >= 0 && (int32_t)(now - test_until) < 0;
    bool booting = (g_cfg.flags & CFG_FLAG_RGB_BOOTFLASH) && boot_fret >= 0 && (uint32_t)(now - boot_t0) < BOOT_FLASH_US;

    if (testing) {
        if (test_led < MAX_LEDS) { px[test_led] = pack(255, 255, 255, 255, bright); if (test_led + 1 > chain) chain = test_led + 1; }
    } else if (booting) {
        // the fret that picks the running mode flashes; with no fret LEDs the strum LEDs flash in its colour
        if (((now - boot_t0) / BLINK_US) % 2 == 0) {
            const uint8_t *c = g_cfg.colors[boot_fret];
            for (int k = 0; k < n; k++)
                if (L[k].fret == boot_fret || (g_cfg.no_fret_leds && L[k].fret < 0)) SET(k, c[0], c[1], c[2], 255);
        }
    } else if (bt_led == RGB_BT_PAIRING) {
        // Bluetooth pairing: every LED double-blinks blue, like a controller looking for a new console
        uint32_t ph = now % 1200000u;
        bool on = ph < 120000u || (ph >= 240000u && ph < 360000u);
        for (int k = 0; k < n; k++) {
            if (L[k].down) SET(k, L[k].r, L[k].g, L[k].b, 255);
            else SET(k, 0x20, 0x60, 0xFF, on ? 255 : 0);
        }
    } else if (bt_connected_at && (uint32_t)(now - bt_connected_at) < BT_CONNECTED_SHOW_US) {
        for (int k = 0; k < n; k++) SET(k, 0x20, 0x60, 0xFF, 255);   // paired / reconnected
    } else if (charging) {
        // No USB host, only power (a charger, or a power bank feeding the TP4056 through the Pico's USB port):
        // a soft light runs from the orange fret to the green one and on to the strum bar, like a charge bar.
        // Held frets and strums still light up.
        int frets = g_cfg.no_fret_leds ? 0 : NUM_FRETS;
        int steps = frets + (g_cfg.strum_leds ? 1 : 0);
        if (steps == 0) steps = 1;
        uint32_t sweep = CHARGE_SWEEP_US * (uint32_t)steps / NUM_FRETS;
        uint32_t t = now % (sweep + CHARGE_PAUSE_US);
        int32_t head = (int32_t)((uint64_t)t * 1000u * steps / sweep);            // in milli-steps
        for (int k = 0; k < n; k++) {
            int step = L[k].fret >= 0 ? NUM_FRETS - 1 - L[k].fret : frets;          // strum LEDs come after green
            int32_t d = head - step * 1000;                                       // how far the head is past it
            int32_t lv = d < -250 ? 0 : d < 0 ? 255 + d : d < 1600 ? 255 - d * 255 / 1600 : 0;
            if (t >= sweep) lv = 0;
            if (L[k].down) lv = 255;
            SET(k, L[k].r, L[k].g, L[k].b, (uint8_t)lv);
        }
    } else {
        uint8_t speed = g_cfg.rgb_speed < 1 ? 1 : g_cfg.rgb_speed > 10 ? 10 : g_cfg.rgb_speed;
        for (int k = 0; k < n; k++) {
            bool down = L[k].down;
            uint8_t i = L[k].idx;
            uint8_t r = L[k].r, g = L[k].g, b = L[k].b;
            uint8_t level = 255;
            switch (g_cfg.rgb_effect) {
                case EFX_STATIC: break;
                case EFX_DIM:    level = down ? 40 : 255; break;
                case EFX_OFF:    level = down ? 0 : 255; break;
                case EFX_BRIGHT: level = down ? 255 : 64; break;
                case EFX_FADE: {
                    uint32_t fade_ms = 1100u - speed * 100u;           // 1000 ms .. 100 ms
                    uint8_t step = (uint8_t)((255u * (FRAME_US / 1000u)) / fade_ms) + 1;
                    if (down) fade[i] = 255;
                    else fade[i] = fade[i] > step ? fade[i] - step : 0;
                    level = fade[i] < 28 ? 28 : fade[i];
                    break;
                }
                case EFX_BREATHE: {
                    if (down) { level = 255; break; }
                    uint32_t period = 4000000u - speed * 350000u;      // 3.65 s .. 0.5 s
                    uint32_t ph = ((now + i * (period / 10)) % period) * 512u / period;   // 0..511
                    uint32_t tri = ph < 256 ? ph : 511 - ph;
                    level = (uint8_t)(40 + tri * 100 / 255);
                    break;
                }
                case EFX_RAINBOW: {
                    if (down) { level = 255; break; }
                    uint32_t hue = (now / 1000u * speed / 40u + i * 40u) & 0xFF;
                    hsv((uint8_t)hue, &r, &g, &b);
                    level = 150;
                    break;
                }
                default: break;
            }
            if (sp && !down) {
                // star power / overdrive from the game: idle LEDs glow a pulsing cyan
                uint32_t ph = (now % 600000u) * 512u / 600000u;
                uint32_t tri = ph < 256 ? ph : 511 - ph;
                r = 0x40; g = 0xE0; b = 0xFF;
                level = (uint8_t)(110 + tri * 145 / 255);
            }
            SET(k, r, g, b, level);
        }
    }
#undef SET
    output(px, chain);
}
