// Fret and strum bar lighting: WS2812 / SK6812 (RGBW) over PIO or APA102 / SK9822 (data + clock, 4 MHz), per-fret colour,
// remappable chain order, press-reactive effects, brightness, a boot-time mode indicator and
// star power glow when a game reports it. One chain of up to 9 LEDs: the five fret LEDs (optional) and up
// to eight strum bar LEDs (one per side, the four corners, or four along each side), in any order along the chain.
#include "rgb.h"
#include <string.h>
#include "pico/stdlib.h"
#include "hardware/pio.h"
#include "hardware/gpio.h"
#include "hardware/clocks.h"
#include "config.h"
#include "input.h"
#include "ws2812.pio.h"

#define FRAME_US    8000u
#define BOOT_FLASH_US 1000000u
#define BLINK_US    125000u
#define TEST_HOLD_US 2500000u

static PIO rgb_pio = pio0;
static const uint rgb_sm = 0;
static uint rgb_offset;
static bool program_loaded;
static int cur_pin = -1, cur_clk = -1, cur_type = -1;
static uint32_t apa_half_cycles;      // APA102 clock half period in CPU cycles (see apa102_byte)
static volatile bool star_power;
static volatile uint16_t whammy_in;        // 0..32767
static volatile bool pstar_in;             // the player's star power button / tilt
static volatile bool charging;
static volatile uint8_t bt_led;
static volatile uint32_t bt_connected_at;

void rgb_set_star_power(bool on) { star_power = on; }

// Lights page preview (VREQ_LEDPREVIEW): the page's clicked frets / strum / star / whammy act as extra inputs while
// requests keep arriving (it lapses 1 s after the last one, so a closed page can't leave it stuck).
static volatile uint16_t pv_bits;
static volatile bool pv_on;
static volatile uint32_t pv_at;
void rgb_preview(uint16_t bits, bool on) { pv_bits = bits; pv_at = time_us_32(); pv_on = on; }
static uint16_t pv(void) { return pv_on && time_us_32() - pv_at < 1000000u ? pv_bits : 0; }
static bool pv_active(void) { return pv_on && time_us_32() - pv_at < 1000000u; }
static bool fn_in(int f) { return input_func(f) || (f < 5 ? (pv() >> f) & 1 : f == F_STRUM_UP ? (pv() >> 5) & 1 : f == F_STRUM_DOWN ? (pv() >> 6) & 1 : 0); }
void rgb_set_whammy(uint16_t w) { whammy_in = w; }
void rgb_set_player_star(bool pressed) { pstar_in = pressed; }
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

// WS2812s are linear: a screen colour like #EF4444 (a clear red on a monitor) comes out pink and
// #FB923C (orange) comes out a washed-out peach, because the "small" channels are still far too bright.
// A gamma 2.6 curve maps the picked colour to what the eye expects from the LED.
static const uint8_t gamma8[256] = {
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3,
    3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 7,
    7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12,
    13, 13, 13, 14, 14, 15, 15, 16, 16, 17, 17, 18, 18, 19, 19, 20,
    20, 21, 21, 22, 22, 23, 24, 24, 25, 25, 26, 27, 27, 28, 29, 29,
    30, 31, 31, 32, 33, 34, 34, 35, 36, 37, 38, 38, 39, 40, 41, 42,
    42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57,
    58, 59, 60, 61, 62, 63, 64, 65, 66, 68, 69, 70, 71, 72, 73, 75,
    76, 77, 78, 80, 81, 82, 84, 85, 86, 88, 89, 90, 92, 93, 94, 96,
    97, 99, 100, 102, 103, 105, 106, 108, 109, 111, 112, 114, 115, 117, 119, 120,
    122, 124, 125, 127, 129, 130, 132, 134, 136, 137, 139, 141, 143, 145, 146, 148,
    150, 152, 154, 156, 158, 160, 162, 164, 166, 168, 170, 172, 174, 176, 178, 180,
    182, 184, 186, 188, 191, 193, 195, 197, 199, 202, 204, 206, 209, 211, 213, 215,
    218, 220, 223, 225, 227, 230, 232, 235, 237, 240, 242, 245, 247, 250, 252, 255,
};

void rgb_init(void) {
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
        if (clk < 0 || clk == pin) return;
        gpio_init(pin); gpio_set_dir(pin, GPIO_OUT); gpio_put(pin, 0);
        gpio_init(clk); gpio_set_dir(clk, GPIO_OUT); gpio_put(clk, 0);
        gpio_set_drive_strength(pin, GPIO_DRIVE_STRENGTH_8MA);
        gpio_set_drive_strength(clk, GPIO_DRIVE_STRENGTH_8MA);
        apa_half_cycles = clock_get_hz(clk_sys) / 8000000u;              // half of a 4 MHz period
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

// rgb -> hue (the same 6 x 43 steps hsv() uses), saturation, value
static void rgb2hsv(const uint8_t c[3], uint8_t *h, uint8_t *sat, uint8_t *v) {
    int r = c[0], g = c[1], b = c[2];
    int mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b), d = mx - mn;
    int x = 0;
    if (d) x = mx == r ? (g - b) * 43 / d + (g < b ? 258 : 0) : mx == g ? 86 + (b - r) * 43 / d : 172 + (r - g) * 43 / d;
    *h = (uint8_t)x;
    *sat = mx ? (uint8_t)(d * 255 / mx) : 0;
    *v = (uint8_t)mx;
}

// rotate a colour's hue by dh (0..255 = a full turn), keeping saturation and value
static void hue_rot(uint8_t c[3], uint8_t dh) {
    uint8_t h, sat, v, o[3];
    rgb2hsv(c, &h, &sat, &v);
    hsv((uint8_t)(h + dh), &o[0], &o[1], &o[2]);
    for (int i = 0; i < 3; i++) c[i] = (uint8_t)((255 - sat * (255 - o[i]) / 255) * v / 255);
}

typedef struct { uint8_t r, g, b, gb; } px_t;   // gb: APA102 5-bit global brightness (31 for WS2812 / SK6812)

// l = gamma-corrected colour x level (0..255*255 per channel), i.e. linear light; scaled by the global brightness
static px_t pack_l(const uint16_t l[3], uint8_t bright) {
    uint32_t vr = (uint32_t)l[0] * bright / 255u, vg = (uint32_t)l[1] * bright / 255u, vb = (uint32_t)l[2] * bright / 255u;   // colour x 255
    if (cur_type == LED_APA102) {
        // APA102 / SK9822: put the dimming in the chip's 5-bit brightness and keep the colour bytes large,
        // so dim colours and slow fades keep their tint instead of stepping through a handful of levels
        uint32_t m = vr > vg ? (vr > vb ? vr : vb) : (vg > vb ? vg : vb);
        uint32_t gb = (m * 31u + 65024u) / 65025u;
        if (gb < 1) gb = 1;
        px_t p = { (uint8_t)(vr * 31u / (255u * gb)), (uint8_t)(vg * 31u / (255u * gb)), (uint8_t)(vb * 31u / (255u * gb)), (uint8_t)gb };
        return p;
    }
    px_t p = { (uint8_t)(vr / 255u), (uint8_t)(vg / 255u), (uint8_t)(vb / 255u), 31 };
    return p;
}

static px_t pack(uint8_t r, uint8_t g, uint8_t b, uint8_t level, uint8_t bright) {
    uint16_t l[3] = { (uint16_t)(gamma8[r] * level), (uint16_t)(gamma8[g] * level), (uint16_t)(gamma8[b] * level) };
    return pack_l(l, bright);
}

// APA102 clock: about 4 MHz whatever the system clock, slow enough for long or unshielded wires
// (the chips take far more, but the edges round off over a metre of ribbon cable) and still under 0.2 ms a frame
static void apa102_byte(uint8_t v) {
    for (int i = 7; i >= 0; i--) {
        gpio_put(cur_pin, (v >> i) & 1);
        busy_wait_at_least_cycles(apa_half_cycles);
        gpio_put(cur_clk, 1);
        busy_wait_at_least_cycles(apa_half_cycles);
        gpio_put(cur_clk, 0);
    }
}

// the three colour bytes in wire order. APA102 / SK9822 chips take blue, green, red, so for them the
// default setting (0) means BGR and the "BGR" slot means GRB; every other order reads the same for both types.
static void order_bytes(uint8_t r, uint8_t g, uint8_t b, uint8_t c[3]) {
    uint8_t o = g_cfg.led_order;
    if (cur_type == LED_APA102) o = o == ORDER_GRB ? ORDER_BGR : o == ORDER_BGR ? ORDER_GRB : o;
    switch (o) {
        case ORDER_RGB: c[0] = r; c[1] = g; c[2] = b; break;
        case ORDER_BRG: c[0] = b; c[1] = r; c[2] = g; break;
        case ORDER_RBG: c[0] = r; c[1] = b; c[2] = g; break;
        case ORDER_GBR: c[0] = g; c[1] = b; c[2] = r; break;
        case ORDER_BGR: c[0] = b; c[1] = g; c[2] = r; break;
        default:        c[0] = g; c[1] = r; c[2] = b; break;          // GRB (WS2812B)
    }
}

static void output(const px_t *px, int n) {
    uint8_t c[3];
    if (cur_type == LED_APA102) {
        for (int i = 0; i < 4; i++) apa102_byte(0x00);                    // start frame
        for (int i = 0; i < n; i++) {
            order_bytes(px[i].r, px[i].g, px[i].b, c);
            apa102_byte(0xE0 | px[i].gb);                                 // 111 + 5-bit brightness
            apa102_byte(c[0]); apa102_byte(c[1]); apa102_byte(c[2]);
        }
        // end frame: the data runs one half clock behind per LED, so n/2 more clocks push it to the last one.
        // Zeros rather than 0xFF: SK9822 clones latch on them, and an extra LED past the chain stays dark.
        int end = (n + 15) / 16; if (end < 4) end = 4;
        for (int i = 0; i < end; i++) apa102_byte(0x00);
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
        order_bytes(r, g, b, c);
        pio_sm_put_blocking(rgb_pio, rgb_sm, (((uint32_t)c[0] << 16) | ((uint32_t)c[1] << 8) | c[2]) << 8);
    }
}

// one shared (not inlined) colour path keeps rgb_task small
static void __attribute__((noinline)) set_px(px_t *px, uint8_t pos, uint8_t r, uint8_t g, uint8_t b, uint8_t level, uint8_t bright) {
    if (pos < MAX_LEDS) px[pos] = pack(r, g, b, level, bright);
}

// ---------------------------------------------------------------- LED engine v2
// Two zones (frets, strum bar). Every frame each LED gets an idle result, then the press reaction, star power,
// whammy, the star flash and the sleep fade. All maths is integer; colours are carried as linear light
// (gamma-corrected colour x level, 0..65025 per channel) so blends and dimming behave like the real LEDs.

// One light in the chain: a fret LED or a strum LED
typedef struct {
    uint8_t pos;            // position in the chain
    uint8_t r, g, b;        // its idle colour
    uint8_t pr, pg, pb;     // the colour it shows when pressed
    uint8_t idx;            // 0..4 fret, 5..12 strum LED (effect state and phase)
    int8_t  fret;           // the fret it sits under, -1 for a strum LED
    bool    down;           // its button is held (the fret, or the strum direction it follows)
    bool    second;         // a fret's second LED: draws like the first and shares its state
} light_t;

static bool last_up = true;   // the last strum direction held (colours the fade-out of a strum press)

static int build_lights(light_t *l, int *chain) {
    int n = 0, len = 0;
    const led_zone_t *zf = &g_cfg.zone_frets, *zs = &g_cfg.zone_strum;
    if (!g_cfg.no_fret_leds)
        for (int f = 0; f < NUM_FRETS; f++)
            for (int s = 0; s < g_cfg.fret_leds; s++) {     // a fret's second LED: same state, own colour if LEDF_FRET2_OWN
                const uint8_t *c = (s && (g_cfg.led_flags & LEDF_FRET2_OWN)) ? g_cfg.fret2_color[f] : g_cfg.colors[f];
                const uint8_t *p = (zf->zflags & ZF_SAME) ? c : g_cfg.fret_press[f];
                l[n++] = (light_t){ s ? g_cfg.led_map2[f] : g_cfg.led_map[f], c[0], c[1], c[2], p[0], p[1], p[2],
                                    (uint8_t)f, (int8_t)f, fn_in(f), s != 0 };
            }
    static const uint8_t white3[3] = {255, 255, 255};
    bool white = !g_cfg.strum_color[0] && !g_cfg.strum_color[1] && !g_cfg.strum_color[2];
    bool up = fn_in(F_STRUM_UP), dn = fn_in(F_STRUM_DOWN);
    if (up) last_up = true; else if (dn) last_up = false;
    for (int i = 0; i < g_cfg.strum_leds && i < MAX_STRUM_LEDS; i++) {
        uint8_t role = strum_led_role(&g_cfg, i);
        bool down = role == STRUM_ROLE_UP ? up : role == STRUM_ROLE_DOWN ? dn : (up || dn);
        const uint8_t *c = (zs->zflags & ZF_PER_LED) ? g_cfg.strum_led_color[i] : white ? white3 : g_cfg.strum_color;
        bool upc = role == STRUM_ROLE_UP || (role == STRUM_ROLE_BOTH && last_up);
        const uint8_t *p = (zs->zflags & ZF_SAME) ? c : upc ? g_cfg.strum_up_color : g_cfg.strum_down_color;
        l[n++] = (light_t){ strum_led_pos(&g_cfg, i), c[0], c[1], c[2], p[0], p[1], p[2], (uint8_t)(NUM_FRETS + i), -1, down, false };
    }
    for (int k = 0; k < n; k++) if (l[k].pos < MAX_LEDS && l[k].pos + 1 > len) len = l[k].pos + 1;
    *chain = len;
    return n;
}

static const uint8_t sin_lut[64] = {   // 1/2 + 1/2 sin over one turn, 0..255
    128, 140, 152, 165, 176, 188, 198, 208, 218, 226, 234, 240, 245, 250, 253, 254,
    255, 254, 253, 250, 245, 240, 234, 226, 218, 208, 198, 188, 176, 165, 152, 140,
    128, 115, 103, 90, 79, 67, 57, 47, 37, 29, 21, 15, 10, 5, 2, 1,
    0, 1, 2, 5, 10, 15, 21, 29, 37, 47, 57, 67, 79, 90, 103, 115,
};

// per-LED animation state (a fret's two LEDs share one)
typedef struct { uint32_t t0; uint8_t fade, spark, noise, target, hue, held; } st_t;
// a ripple or a comet in a zone
typedef struct { uint32_t t0; uint8_t k0; int8_t dir; bool on; } wave_t;

static st_t st[NUM_LEDS + MAX_STRUM_LEDS];
static wave_t wv[2][4];
static uint32_t rng_s = 2463534242u;
static uint32_t t_ms, t_rem, frame_us, fire_t, last_in, flash_t0;
static uint16_t in_mask;
static int32_t w_ref;
static bool ps_prev, flash_on;
static uint8_t g_dh;                    // hue turn applied to every colour of the LED being drawn (whammy HUE)

static uint32_t tick(void) {            // our own millisecond clock, advanced per frame
    t_rem += frame_us;
    t_ms += t_rem / 1000u;
    t_rem %= 1000u;
    return t_ms;
}

static uint32_t rnd(void) { rng_s ^= rng_s << 13; rng_s ^= rng_s >> 17; rng_s ^= rng_s << 5; return rng_s; }

// 1/2 + 1/2 sin(2 pi ph / 256), 0..255
static uint8_t sin01(uint8_t ph) {
    int a = sin_lut[ph >> 2], b = sin_lut[((ph >> 2) + 1) & 63];
    return (uint8_t)(a + (b - a) * (ph & 3) / 4);
}

// triangle 0..255 over a period of P ms
static uint32_t tri(uint32_t x, uint32_t P) {
    uint32_t ph = (x % P) * 512u / P;
    return ph < 256 ? ph : 511 - ph;
}

// colour at a level -> linear light
static void lit(uint16_t *o, const uint8_t *c, uint32_t lv) {
    uint8_t d[3] = { c[0], c[1], c[2] };
    if (g_dh) hue_rot(d, g_dh);
    for (int i = 0; i < 3; i++) o[i] = (uint16_t)(gamma8[d[i]] * lv);
}

static void mix(uint16_t *o, const uint16_t *a, const uint16_t *b, uint32_t t) {   // a -> b by t/255
    for (int i = 0; i < 3; i++) o[i] = (uint16_t)((int32_t)a[i] + ((int32_t)b[i] - a[i]) * (int32_t)t / 255);
}

static void white_mix(uint16_t *o, uint32_t t) {
    static const uint16_t w3[3] = {65025, 65025, 65025};
    mix(o, o, w3, t);
}

static void scale(uint16_t *o, uint32_t g) {
    for (int i = 0; i < 3; i++) o[i] = (uint16_t)(o[i] * g / 255u);
}

// one idle animation for LED k of n: colour c at level Lv (0..255), speed s
static void idle_light(uint16_t *o, uint8_t mode, const uint8_t *c, uint32_t Lv, uint32_t s, const st_t *q, uint32_t k, uint32_t n, uint32_t t) {
    uint32_t g = 255;
    uint8_t col[3] = { c[0], c[1], c[2] };
    switch (mode) {
        case IDLE_OFF: g = 0; break;
        case IDLE_BREATHE: { uint32_t P = 4000u - 350u * s; g = 102 + 153u * tri(t + k * (P / 10), P) / 255; break; }
        case IDLE_HEARTBEAT: {
            uint32_t P = 1600u - 100u * s, x = (t + k * (P / 10)) % P * 1000u / P;
            int u = x < 120 ? (int)(x * 255 / 120) : (x >= 200 && x < 320) ? (int)((x - 200) * 255 / 120) : -1;
            int h = u < 0 ? 0 : 2 * sin01((uint8_t)(u >> 1)) - 255;
            g = 51 + 204u * (h < 0 ? 0 : h) / 255;
            break;
        }
        case IDLE_RAINBOW: hsv((uint8_t)(t * s / 40u + 40u * k), &col[0], &col[1], &col[2]); break;
        case IDLE_RAINBOW_WAVE: hsv((uint8_t)(t * s / 40u + 256u * k / n), &col[0], &col[1], &col[2]); break;
        case IDLE_COLOR_WAVE: g = 77 + 178u * sin01((uint8_t)(t * s * 8u / 125u - 256u * k / n)) / 255; break;
        case IDLE_SPARKLE: g = 64; break;                      // base 25 %, the sparkle itself is mixed in by the caller
        case IDLE_CHASE: {
            uint32_t span = n * 1000u, head = t * s * 5u / 3u % span;
            int32_t d = (int32_t)(k * 1000u) - (int32_t)head;
            if (d < 0) d = -d;
            if ((uint32_t)d > span / 2) d = (int32_t)span - d;
            g = 255 - (uint32_t)d * 255 / 1500;
            if (g < 38) g = 38;
            break;
        }
        case IDLE_FIRE: g = 115 + 140u * q->noise / 255; break;
        case IDLE_HUE_DRIFT: hue_rot(col, (uint8_t)(t * s / 80u)); break;
        default: break;                                        // SOLID
    }
    lit(o, col, Lv * g / 255);
}

static void star_light(uint16_t *o, const st_t *q, uint32_t k, uint32_t n, uint32_t t) {
    static const uint8_t map[NUM_STAR] = { IDLE_SOLID, IDLE_SOLID, IDLE_RAINBOW_WAVE, IDLE_SOLID, IDLE_CHASE, IDLE_FIRE, IDLE_SOLID };
    uint32_t P = 1100u - 100u * g_cfg.star_speed;
    uint8_t a = g_cfg.star_anim;
    const uint8_t *c = g_cfg.star_color;
    if (a == STAR_PULSE) lit(o, c, 110 + 145u * tri(t, P) / 255);
    else if (a == STAR_STROBE) lit(o, c, (t / (P / 8u)) & 1 ? 0 : 255);
    else if (a == STAR_SPARKLE) { idle_light(o, IDLE_SOLID, c, 128, 10, q, k, n, t); white_mix(o, q->spark); }
    else idle_light(o, map[a < NUM_STAR ? a : 0], c, 255, 10, q, k, n, t);
}

static inline const led_zone_t *zone_of(const light_t *l) { return l->fret >= 0 ? &g_cfg.zone_frets : &g_cfg.zone_strum; }
static inline uint32_t zone_n(const light_t *l) { return l->fret >= 0 ? NUM_FRETS : g_cfg.strum_leds; }
static inline uint32_t zone_k(const light_t *l) { return l->fret >= 0 ? (uint32_t)l->fret : (uint32_t)l->idx - NUM_FRETS; }
static inline uint32_t fade_ms(const led_zone_t *z) { return 1100u - 100u * z->fade; }

static void spawn(int zi, uint32_t k0, int dir, uint32_t t) {
    wave_t *w = wv[zi], *pick = w;
    for (int i = 0; i < 4; i++) {
        if (!w[i].on) { pick = &w[i]; break; }
        if ((int32_t)(w[i].t0 - pick->t0) < 0) pick = &w[i];       // none free: replace the oldest
    }
    *pick = (wave_t){ t, (uint8_t)k0, (int8_t)dir, true };
}

// advance the per-LED state by one frame
static void update_states(const light_t *L, int n, uint32_t t, bool star) {
    bool newtgt = (int32_t)(t - fire_t) >= 0;                       // new fire targets every ~60 ms
    if (newtgt) fire_t = t + 60;
    for (int i = 0; i < n; i++) {
        const light_t *l = &L[i];
        if (l->second) continue;
        st_t *q = &st[l->idx];
        const led_zone_t *z = zone_of(l);
        bool h = l->down;
        if (h && !q->held) {                                        // a press
            q->t0 = t;
            q->hue = (uint8_t)rnd();
            int zi = l->fret < 0, k = (int)zone_k(l);
            if (z->press == PRESS_RIPPLE) spawn(zi, k, 0, t);
            else if (z->press == PRESS_SWEEP) {
                if (zi) spawn(1, k, (strum_led_role(&g_cfg, k) == STRUM_ROLE_UP || (strum_led_role(&g_cfg, k) == STRUM_ROLE_BOTH && last_up)) ? 1 : -1, t);
                else { spawn(0, k, 1, t); spawn(0, k, -1, t); }
            }
        }
        q->held = h;
        if (h) q->fade = 255;
        else { uint32_t step = 2040u / fade_ms(z) + 1; q->fade = q->fade > step ? (uint8_t)(q->fade - step) : 0; }
        if (newtgt) q->target = (uint8_t)rnd();
        q->noise = (uint8_t)(q->noise + ((int)q->target - q->noise) / 4);
        q->spark = q->spark > 8 ? q->spark - 8 : 0;
        bool starlit = star && !h && ((g_cfg.star_zones >> (l->fret < 0)) & 1);
        uint32_t rate = starlit ? (g_cfg.star_anim == STAR_SPARKLE ? g_cfg.star_speed : 0) : (z->idle == IDLE_SPARKLE ? z->speed : 0);
        if (rate && rnd() % 400u < rate) q->spark = 255;
    }
    for (int zi = 0; zi < 2; zi++) {                                // retire finished ripples / comets
        const led_zone_t *z = zi ? &g_cfg.zone_strum : &g_cfg.zone_frets;
        uint32_t zn = zi ? g_cfg.strum_leds : NUM_FRETS, F = fade_ms(z);
        uint32_t lim = !zn ? 0 : z->press == PRESS_RIPPLE ? F + 80u * zn : z->press == PRESS_SWEEP ? F * (zn + 3) / zn : 0;
        for (int i = 0; i < 4; i++) if (wv[zi][i].on && t - wv[zi][i].t0 >= lim) wv[zi][i].on = false;
    }
}

// how far (0..255) the ripples / comets of the LED's zone reach it
static uint32_t wave_amt(const light_t *l, const led_zone_t *z, uint32_t t) {
    int zi = l->fret < 0, k = (int)zone_k(l);
    int32_t F = (int32_t)fade_ms(z), nz = (int32_t)zone_n(l), best = 0;
    for (int i = 0; i < 4; i++) {
        const wave_t *w = &wv[zi][i];
        if (!w->on) continue;
        int32_t age = (int32_t)(t - w->t0), a = 0;
        if (z->press == PRESS_RIPPLE) {
            int32_t d = k - w->k0, e;
            e = age - 80 * (d < 0 ? -d : d);
            if (e < 0) e = -e;
            if (e < 120) a = 255 * (120 - e) / 120;
        } else {
            int32_t dl = age * nz * 1000 / F - (k - w->k0) * w->dir * 1000;   // milli-LEDs the head is past this LED
            static const uint8_t tail[3] = { 255, 127, 51 };
            if (dl >= 0 && dl < 3000) a = tail[dl / 1000];
        }
        if (a > best) best = a;
    }
    return (uint32_t)best;
}

// the press reaction, applied on top of the idle light o
static void press_light(uint16_t *o, const light_t *l, const led_zone_t *z, const st_t *q, uint32_t t) {
    uint8_t c[3] = { l->r, l->g, l->b }, pc[3] = { l->pr, l->pg, l->pb };
    uint16_t P[3];
    bool h = l->down;
    uint32_t a = 0;
    lit(P, pc, 255);
    switch (z->press) {
        case PRESS_COLOR: a = h ? 255 : 0; break;
        case PRESS_FLASH_FADE: a = q->fade; break;
        case PRESS_DIM: if (h) lit(o, c, 38); break;
        case PRESS_OFF: if (h) memset(o, 0, 6); break;
        case PRESS_STROBE:
            if (h) { if (((t - q->t0) / (40u + 15u * (10u - z->speed))) & 1) memset(o, 0, 6); else memcpy(o, P, 6); }
            break;
        case PRESS_RIPPLE: case PRESS_SWEEP: a = h ? 255 : wave_amt(l, z, t); break;
        case PRESS_RAINBOW: { uint8_t rc[3]; hsv(q->hue, &rc[0], &rc[1], &rc[2]); lit(P, rc, 255); a = q->fade; break; }
        case PRESS_SPARK: if (h && t - q->t0 < 60) { P[0] = P[1] = P[2] = 65025; } a = q->fade; break;
        default: break;
    }
    if (a) mix(o, o, P, a);
}

static void render(const light_t *L, int n, px_t *px, uint8_t bright, uint32_t t) {
    const yacc_config_t *c = &g_cfg;
    bool pva = pv_active();
    bool pstar = pva && ((pv_bits >> 7) & 1);
    bool star = (star_power && (c->flags & CFG_FLAG_RGB_STARPOWER)) || pstar;
    uint32_t w = whammy_in > 32767 ? 32767 : whammy_in;
    if (pva && (uint32_t)(pv_bits >> 8) * 32767u / 255u > w) w = (uint32_t)(pv_bits >> 8) * 32767u / 255u;
    uint32_t w8 = w >> 7;
    bool ps = pstar_in || pstar;

    // any input restarts the sleep timer; the star flash fires on the player's star power press
    uint16_t mask = ps ? 1u << NUM_FUNCS : 0;
    for (int f = 0; f < NUM_FUNCS; f++) if (fn_in(f)) mask |= 1u << f;
    int32_t dw = (int32_t)w - w_ref;
    if (mask != in_mask || dw > 400 || dw < -400) { in_mask = mask; w_ref = (int32_t)w; last_in = t; }
    if (ps && !ps_prev && (c->led_flags & LEDF_STAR_FLASH)) { flash_t0 = t; flash_on = true; }
    ps_prev = ps;
    uint32_t flash = 0;
    if (flash_on) {
        uint32_t age = t - flash_t0;
        if (age < 150) flash = 255; else if (age < 350) flash = 255 * (350 - age) / 200; else flash_on = false;
    }
    uint32_t slp = 255;
    if (c->sleep_min) {
        uint32_t idle = t - last_in, lim = c->sleep_min * 60000u;
        if (idle > lim) slp = idle - lim >= 2000 ? 0 : 255 - (idle - lim) * 255 / 2000;
    }

    update_states(L, n, t, star);
    for (int i = 0; i < n; i++) {
        const light_t *l = &L[i];
        const led_zone_t *z = zone_of(l);
        const st_t *q = &st[l->idx];
        uint32_t zi = l->fret < 0, k = zone_k(l), zn = zone_n(l);
        uint8_t col[3] = { l->r, l->g, l->b };
        uint16_t o[3];
        bool wz = c->whammy_fx && w8 && ((c->whammy_zones >> zi) & 1);
        g_dh = (wz && c->whammy_fx == WFX_HUE) ? (uint8_t)(96u * w8 / 255u) : 0;
        if (star && !l->down && ((c->star_zones >> zi) & 1)) star_light(o, q, k, zn, t);
        else {
            idle_light(o, z->idle, col, z->idle_level * 255u / 100u, z->speed, q, k, zn, t);
            if (z->idle == IDLE_SPARKLE) white_mix(o, q->spark);
            press_light(o, l, z, q, t);
        }
        if (wz) {
            uint32_t g = 255;
            if (c->whammy_fx == WFX_BRIGHT) g = 89 + 166u * w8 / 255;
            else if (c->whammy_fx == WFX_PULSE) g = 255 - (153u * w8 / 255) * sin01((uint8_t)(t * 8u / 5u)) / 255;
            else if (c->whammy_fx == WFX_WAVE) g = 255 - (178u * w8 / 255) * sin01((uint8_t)(t * 64u / 75u - 256u * k / zn)) / 255;
            if (g != 255) scale(o, g);
        }
        if (flash) white_mix(o, flash);
        if (slp != 255) scale(o, slp);
        if (l->pos < MAX_LEDS) px[l->pos] = pack_l(o, bright);
    }
    g_dh = 0;
}

void rgb_task(void) {
    bool enabled = (g_cfg.flags & CFG_FLAG_RGB_ENABLED) && g_cfg.rgb_pin < NUM_DIGITAL_PINS;
    if (!program_loaded) return;
    int clk = (g_cfg.led_type == LED_APA102 && g_cfg.led_clk_pin < NUM_DIGITAL_PINS) ? (int)g_cfg.led_clk_pin : -1;
    attach(enabled ? (int)g_cfg.rgb_pin : -1, clk, g_cfg.led_type);
    if (!enabled || cur_pin < 0) return;

    uint32_t now = time_us_32();
    if ((uint32_t)(now - last_frame) < FRAME_US) return;
    frame_us = now - last_frame;
    last_frame = now;

    uint8_t bright = g_cfg.rgb_brightness;                  // 0..255, capped for the layout (led_max_brightness)
    if (bright > led_max_brightness(&g_cfg)) bright = led_max_brightness(&g_cfg);
    light_t L[MAX_LEDS];
    int chain;
    int n = build_lights(L, &chain);
    px_t px[MAX_LEDS];
    memset(px, 0, sizeof(px));
#define SET(k, rr, gg, bb, lv) set_px(px, L[k].pos, (rr), (gg), (bb), (lv), bright)
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
        render(L, n, px, bright, tick());
    }
#undef SET
    output(px, chain);
}
