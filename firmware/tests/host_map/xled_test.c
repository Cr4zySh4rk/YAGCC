// Host test for the extra LED zones (ext bytes 358..400, firmware 0.56): validation, position mapping, brightness
// ceiling and the input driven effect frames.
// cc -I../../src xled_test.c ../../src/ext_config.c
#include <stdio.h>
#include <string.h>
#include "ext_config.h"

static int fails;
#define CHECK(c) do { if (!(c)) { printf("FAIL line %d: %s\n", __LINE__, #c); fails++; } } while (0)

static ext_config_t mk(void) { ext_config_t e; ext_defaults(&e); return e; }
static bool ok(ext_config_t *e, const yacc_config_t *m) { ext_seal(e); return ext_validate(e, m); }
static yacc_config_t main_cfg(void) {
    yacc_config_t c; memset(&c, 0, sizeof c);
    memset(c.pins, PIN_NONE, sizeof c.pins);
    c.tilt_pin = c.rgb_pin = c.led_clk_pin = c.host_dp_pin = c.rumble_pin = PIN_NONE;
    c.ps2_att = c.ps2_cmd = c.ps2_dat = c.ps2_clk = c.ps2_ack = c.wii_sda = c.wii_scl = c.accel_sda = c.accel_scl = PIN_NONE;
    c.rgb_pin = 10; c.fret_leds = 1; c.strum_leds = 0;
    for (int f = 0; f < NUM_FRETS; f++) c.led_map[f] = (uint8_t)f;
    return c;
}

int main(void) {
    // layout
    ext_config_t e = mk();
    CHECK(sizeof(xzone_t) == 10 && (uint8_t *)&e.xled_pin - (uint8_t *)&e == 358 && (uint8_t *)&e.xzone - (uint8_t *)&e == 361);
    CHECK(offsetof(ext_config_t, crc) == 508);
    yacc_config_t m = main_cfg();

    // zeros are valid, also an old config (rsv bytes 0, so xled_pin = 0 and no zone)
    CHECK(ok(&e, &m) && ok(&e, NULL));
    memset(e.xled_pin, 0, 3); memset(e.xzone, 0, sizeof e.xzone); CHECK(ok(&e, &m));

    // limits per zone
    static const int mx[4] = {15, 2, 2, 30};
    for (int z = 0; z < 4; z++) {
        e = mk(); e.xzone[z].count = (uint8_t)mx[z]; e.xzone[z].start = 20; e.xzone[z].effect = ZE_SOLID; CHECK(ok(&e, &m));
        e.xzone[z].count = (uint8_t)(mx[z] + 1); CHECK(!ok(&e, &m));
    }
    // start / length within the chain
    e = mk(); e.xzone[3].count = 30; e.xzone[3].start = 42; CHECK(ok(&e, &m));
    e.xzone[3].start = 43; CHECK(!ok(&e, &m));
    e = mk(); e.xzone[1].count = 1; e.xzone[1].start = 72; CHECK(!ok(&e, &m));
    // enums
    e = mk(); e.xzone[0].count = 3; e.xzone[0].start = 20; e.xzone[0].effect = ZE_SPARKLE; CHECK(ok(&e, &m));
    e.xzone[0].effect = 9; CHECK(!ok(&e, &m));
    e.xzone[0].effect = ZE_SOLID; e.xzone[0].flags = ZX_REVERSE | ZX_STAR; CHECK(ok(&e, &m));
    e.xzone[0].flags = 4; CHECK(!ok(&e, &m));
    e.xzone[0].flags = 0; e.xzone[0].level = 100; CHECK(ok(&e, &m)); e.xzone[0].level = 101; CHECK(!ok(&e, &m));
    e.xzone[0].level = 0; e.xzone[0].chain = 4; CHECK(!ok(&e, &m));
    // overlap on a chain, none across chains
    e = mk(); e.xzone[0].count = 10; e.xzone[0].start = 20; e.xzone[3].count = 10; e.xzone[3].start = 29; CHECK(!ok(&e, &m));
    e.xzone[3].start = 30; CHECK(ok(&e, &m));
    e = mk(); e.xzone[0].count = 10; e.xzone[0].start = 0; e.xzone[0].chain = 1; e.xzone[3].count = 10; e.xzone[3].start = 5; e.xzone[3].chain = 2;
    e.xled_pin[0] = 11; e.xled_pin[1] = 12; CHECK(ok(&e, &m));
    e.xzone[3].chain = 1; CHECK(!ok(&e, &m));
    e.xzone[3].start = 10; CHECK(ok(&e, &m));                                 // several zones on one extra pin
    // chain without a pin, bad / duplicate / used pins
    e = mk(); e.xzone[1].count = 2; e.xzone[1].chain = 1; CHECK(!ok(&e, &m));
    e.xled_pin[0] = 11; CHECK(ok(&e, &m));
    e.xled_pin[0] = 23; CHECK(!ok(&e, &m));
    e.xled_pin[0] = 10; CHECK(!ok(&e, &m));                                   // the main LED pin
    m.pins[0] = 11; e.xled_pin[0] = 11; CHECK(!ok(&e, &m)); m.pins[0] = PIN_NONE;
    e.xled_pin[0] = 11; e.pin_ext[2] = 11; CHECK(!ok(&e, &m)); e.pin_ext[2] = PIN_NONE;
    e.xzone[2].count = 1; e.xzone[2].chain = 2; e.xzone[2].start = 0; e.xled_pin[1] = 11; CHECK(!ok(&e, &m));
    e.xled_pin[1] = 12; CHECK(ok(&e, &m));
    // an unused chain's pin value is not checked (old configs have 0 there)
    e = mk(); e.xled_pin[2] = 0; m.pins[1] = 0; CHECK(ok(&e, &m)); m.pins[1] = PIN_NONE;
    // pin_ext checked against xled_pin from its side too
    // per chain LED type (amendment): an APA102 extra chain needs its clock pin, the others must not have one
    e = mk(); e.xzone[1].count = 1; e.xzone[1].chain = 1; e.xled_pin[0] = 11;
    m.led_type = LED_APA102; m.led_clk_pin = 9; CHECK(ok(&e, &m));              // main chain APA102, extra chain WS2812: fine
    m.led_type = LED_WS2812; m.led_clk_pin = PIN_NONE;
    e.xled_type[0] = LED_SK6812_RGBW; e.xled_order[0] = ORDER_RGB; CHECK(ok(&e, &m));
    e.xled_type[0] = LED_APA102; CHECK(!ok(&e, &m));                            // clock missing
    e.xled_clk[0] = 12; CHECK(ok(&e, &m));
    e.xled_order[0] = ORDER_BGR; CHECK(ok(&e, &m));
    e.xled_order[0] = NUM_ORDERS; CHECK(!ok(&e, &m)); e.xled_order[0] = 0;
    e.xled_clk[0] = 11; CHECK(!ok(&e, &m));                                     // clock = data pin
    e.xled_clk[0] = 10; CHECK(!ok(&e, &m));                                     // clock on the main LED pin
    e.xled_clk[0] = 23; CHECK(!ok(&e, &m));
    e.xled_clk[0] = 12; m.pins[3] = 12; CHECK(!ok(&e, &m)); m.pins[3] = PIN_NONE;
    e.pin_ext[0] = 12; CHECK(!ok(&e, &m)); e.pin_ext[0] = PIN_NONE;
    e.xled_type[0] = NUM_LED_TYPES; CHECK(!ok(&e, &m));
    e.xled_type[0] = LED_WS2812; CHECK(!ok(&e, &m));                            // WS2812 with a clock pin
    e.xled_clk[0] = PIN_NONE; CHECK(ok(&e, &m));
    // two APA102 chains: no shared pins
    e.xled_type[0] = LED_APA102; e.xled_clk[0] = 12;
    e.xzone[2].count = 1; e.xzone[2].chain = 2; e.xzone[2].start = 0; e.xled_type[1] = LED_APA102; e.xled_pin[1] = 13; e.xled_clk[1] = 14;
    CHECK(ok(&e, &m));
    e.xled_clk[1] = 12; CHECK(!ok(&e, &m));
    e.xled_clk[1] = 11; CHECK(!ok(&e, &m));
    e.xled_clk[1] = 14; e.xled_pin[1] = 12; CHECK(!ok(&e, &m));
    // an unused chain's type / clock bytes are not looked at
    e = mk(); e.xled_type[2] = 77; e.xled_clk[2] = 5; e.xled_order[2] = 99; CHECK(ok(&e, &m));
    e = mk(); e.xzone[1].count = 1; e.xzone[1].start = 20; CHECK(ok(&e, &m));  // chain 0 follows the main LED type, whatever it is
    m.led_type = LED_APA102; CHECK(ok(&e, &m)); m.led_type = LED_WS2812;
    CHECK(offsetof(ext_config_t, xled_clk) == 401 && offsetof(ext_config_t, xled_type) == 404 && offsetof(ext_config_t, xled_order) == 407);
    e = mk(); CHECK(e.xled_clk[0] == PIN_NONE && e.xled_pin[0] == PIN_NONE && e.xled_type[0] == 0);
    // overlap with the fret / strum LEDs of the main chain (only checked with `main`)
    e = mk(); e.xzone[0].count = 3; e.xzone[0].start = 3; CHECK(!ok(&e, &m) && ok(&e, NULL));
    e.xzone[0].start = 5; CHECK(ok(&e, &m));
    m.strum_leds = 2; m.strum_map[0] = 5; m.strum_map[1] = 6; CHECK(!ok(&e, &m));
    e.xzone[0].start = 7; CHECK(ok(&e, &m));
    m.fret_leds = 2; m.led_map2[4] = 8; CHECK(!ok(&e, &m)); m.no_fret_leds = 1; CHECK(ok(&e, &m));
    m = main_cfg();
    e.xzone[0].chain = 1; e.xzone[0].start = 0; e.xled_pin[0] = 11; CHECK(ok(&e, &m));                  // the same positions on another chain are fine
    // crc / corruption still covered
    e.crc ^= 1; CHECK(!ext_validate(&e, &m));

    // position mapping
    xzone_t x = { .count = 5, .start = 10 };
    for (int k = 0; k < 5; k++) CHECK(xz_pos(&x, k) == 10 + k);
    x.flags = ZX_REVERSE;
    for (int k = 0; k < 5; k++) CHECK(xz_pos(&x, k) == 14 - k);
    x.count = 1; CHECK(xz_pos(&x, 0) == 10);

    // brightness ceiling (layout ceiling, total LEDs, overdrive)
    CHECK(xled_ceiling(255, 18, false) == 255 && xled_ceiling(150, 18, false) == 150);
    CHECK(xled_ceiling(255, 36, false) == 127 && xled_ceiling(100, 36, false) == 100);
    CHECK(xled_ceiling(255, 67, false) == 68 && xled_ceiling(255, 72 + 18, false) == 51);
    CHECK(xled_ceiling(255, 200, false) == 48 && xled_ceiling(40, 200, false) == 40);
    CHECK(xled_ceiling(150, 19, false) == 150 && xled_ceiling(255, 19, false) == 241);
    CHECK(xled_ceiling(110, 67, true) == 255);
    yacc_config_t c = main_cfg(); e = mk();
    CHECK(xled_total(&c, &e) == 5 && led_brightness_ceiling_x(&c, &e) == 255 && led_brightness_ceiling_x(&c, &e) == led_brightness_ceiling(&c, 0));
    c.fret_leds = 2; c.strum_leds = 4; e.xzone[0].count = 15; e.xzone[1].count = 2; e.xzone[2].count = 2; e.xzone[3].count = 30;
    CHECK(xled_total(&c, &e) == 10 + 4 + 49 && led_brightness_ceiling_x(&c, &e) == 110 * 0 + 72);   // 255*18/63 = 72 < layout 110
    e.led_flags = LED_FLAG_OVERDRIVE; CHECK(led_brightness_ceiling_x(&c, &e) == 255);
    c.no_fret_leds = 1; e.led_flags = 0; CHECK(xled_total(&c, &e) == 4 + 49);

    // frames: ZE_PRESS / ZE_FRETS / ZE_SOLID / ZE_FLASH for a simple input
    uint8_t fc[5][3] = { {0,255,0}, {255,0,0}, {255,255,0}, {0,0,255}, {255,128,0} }, col[3];
    xzone_t p = { .count = 2, .effect = ZE_PRESS, .color = {10, 20, 30} };
    CHECK(xz_input_led(&p, 0, 2, fc, 0, false, 0, col) == XZ_DIM && col[0] == 10 && col[1] == 20 && col[2] == 30);
    CHECK(xz_input_led(&p, 1, 2, fc, 0, true, 0, col) == 255 && col[2] == 30);
    xzone_t f = { .count = 6, .effect = ZE_FRETS, .color = {1, 2, 3} };
    CHECK(xz_input_led(&f, 0, 6, fc, 0, false, 0, col) == XZ_DIM && col[0] == 1);
    for (int k = 0; k < 6; k++) { CHECK(xz_input_led(&f, k, 6, fc, 1u << 3, false, 0, col) == 255 && !col[0] && !col[1] && col[2] == 255); }
    int seen[5] = {0};   // green + yellow held: first half green, second half yellow
    for (int k = 0; k < 6; k++) { int r = xz_frets_pick(0x05, k, 6); CHECK(r == 0 || r == 2); seen[r]++; CHECK(r == (k < 3 ? 0 : 2)); }
    CHECK(seen[0] == 3 && seen[2] == 3);
    CHECK(xz_frets_pick(0x1F, 0, 2) == 0 && xz_frets_pick(0x1F, 1, 2) == 2 && xz_frets_pick(0x1F, 0, 15) == 0 && xz_frets_pick(0x1F, 14, 15) == 4);
    CHECK(xz_frets_pick(0, 0, 3) == -1);
    xzone_t so = { .count = 1, .effect = ZE_SOLID, .color = {9, 8, 7} };
    CHECK(xz_input_led(&so, 0, 1, fc, 1, true, 0, col) == 255 && col[0] == 9);
    xzone_t fl = { .count = 1, .effect = ZE_FLASH, .color = {9, 8, 7} };
    CHECK(xz_input_led(&fl, 0, 1, fc, 0, false, 0, col) == XZ_DIM && xz_input_led(&fl, 0, 1, fc, 0, false, 255, col) == 255);
    // zone level and animation rate
    xzone_t lv = {0}; CHECK(xz_level(&lv) == 255); lv.level = 50; CHECK(xz_level(&lv) == 127); lv.level = 100; CHECK(xz_level(&lv) == 255); lv.level = 1; CHECK(xz_level(&lv) == 2);
    CHECK(xz_rate(0) == 32 && xz_rate(128) == 128 && xz_rate(255) == 512);

    if (fails) { printf("%d FAILED\n", fails); return 1; }
    printf("xled_test: all passed\n");
    return 0;
}
