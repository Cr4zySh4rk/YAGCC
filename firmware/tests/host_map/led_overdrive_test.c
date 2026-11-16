// Host test for LED overdrive (ext byte 357, LED_FLAG_OVERDRIVE): validation and the brightness ceiling.
// cc -I../../src led_overdrive_test.c ../../src/ext_config.c
#include <stdio.h>
#include <string.h>
#include "ext_config.h"

static int fails;
#define CHECK(c) do { if (!(c)) { printf("FAIL line %d: %s\n", __LINE__, #c); fails++; } } while (0)

int main(void) {
    ext_config_t e; ext_defaults(&e);
    CHECK(e.led_flags == 0 && ext_validate(&e, NULL));
    ext_defaults(&e); e.led_flags = LED_FLAG_OVERDRIVE; ext_seal(&e); CHECK(ext_validate(&e, NULL));
    CHECK(((uint8_t *)&e)[357] == 1);
    for (int b = 1; b < 8; b++) { ext_defaults(&e); e.led_flags = (uint8_t)(1u << b); ext_seal(&e); CHECK(!ext_validate(&e, NULL)); }
    ext_defaults(&e); e.led_flags = 3; ext_seal(&e); CHECK(!ext_validate(&e, NULL));
    ext_defaults(&e); e.led_flags = 0xff; ext_seal(&e); CHECK(!ext_validate(&e, NULL));

    // ceiling: layout limit without overdrive, 255 with it, for every layout
    yacc_config_t c; memset(&c, 0, sizeof c);
    for (int frets = 0; frets < 2; frets++) for (int two = 0; two < 2; two++) for (int strum = 0; strum < 2; strum++) {
        c.no_fret_leds = !frets; c.fret_leds = two ? 2 : 1; c.strum_leds = strum ? 4 : 0;
        CHECK(led_brightness_ceiling(&c, 0) == led_max_brightness(&c));
        CHECK(led_brightness_ceiling(&c, LED_FLAG_OVERDRIVE) == 255);
    }
    c.no_fret_leds = 0; c.fret_leds = 2; c.strum_leds = 4;
    CHECK(led_max_brightness(&c) == 110 && led_brightness_ceiling(&c, 0) == 110 && led_brightness_ceiling(&c, 1) == 255);
    c.fret_leds = 1; c.strum_leds = 0; CHECK(led_brightness_ceiling(&c, 0) == 255);

    if (fails) { printf("%d FAILED\n", fails); return 1; }
    printf("led_overdrive_test: all passed\n");
    return 0;
}
