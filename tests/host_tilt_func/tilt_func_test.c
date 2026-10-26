// Host test for tilt inputs as buttons (input.c + config.c). Build from the repo root with pico stubs on the include path:
//   gcc -I<stubs> -Ifirmware/src -o t tests/host_tilt_func/tilt_func_test.c firmware/src/config.c   (stubs: pico/stdlib.h, hardware/{gpio,adc,flash,sync}.h, host/usb_host.h)
#include <stdio.h>
#include <string.h>
// ---- stubs for the hardware input.c touches
#include "pico/stdlib.h"
#include "hardware/gpio.h"
#include "hardware/adc.h"
static uint32_t now_us = 1000000, pins_all = 0xFFFFFFFFu;
static int32_t accel_val[3] = {2048, 2048, 2048};
uint32_t time_us_32(void) { return now_us; }
void gpio_init(uint p) {} void gpio_set_dir(uint p, int d) {} void gpio_pull_up(uint p) {}
uint32_t gpio_get_all(void) { return pins_all; }
void adc_init(void) {} void adc_gpio_init(uint p) {} void adc_select_input(uint c) {} uint16_t adc_read(void) { return 0; }
bool rgb_active_pin(int p) { return false; } bool usb_host_pin(int p) { return false; }
bool accel_pin(int p) { return false; } bool rumble_pin_active(int p) { return false; }
bool ps2_out_pin(int p) { return false; } bool wii_out_pin(int p) { return false; }
int32_t accel_raw12(int a) { return accel_val[a]; } int32_t accel_raw12_n(int n, int a) { return -1; } int32_t accel_adc12(int c) { return -1; }
#include "../../firmware/src/input.c"
#include <assert.h>
static int fails;
static uint32_t crc(const uint8_t *d, size_t n) { uint32_t c = 0xFFFFFFFFu; for (size_t i = 0; i < n; i++) { c ^= d[i]; for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & (-(int32_t)(c & 1))); } return ~c; }
void flash_range_erase(uint32_t o, size_t n) {} void flash_range_program(uint32_t o, const uint8_t *d, size_t n) {}
int flash_safe_execute(void (*f)(void *), void *p, uint32_t t) { return 0; }
#define CHECK(c) do { if (!(c)) { printf("FAIL line %d: %s\n", __LINE__, #c); fails++; } } while (0)
static void step(int ms) { for (int i = 0; i < ms * 10; i++) { now_us += 100; input_poll(); } }
static void setpin(int pin, int pressed) { if (pressed) pins_all &= ~(1u << pin); else pins_all |= 1u << pin; }
static void fresh(void) { config_defaults(&g_cfg); memset(slot, 0, sizeof(slot)); tilt_mask = 0; tilt_star_on = false; memset(atilt_on, 0, sizeof atilt_on); pins_all = 0xFFFFFFFFu; for (int i=0;i<3;i++) accel_val[i]=2048; }
int main(void) {
    // ---- config: encoding, defaults, validation
    CHECK(offsetof(yacc_config_t, tilt_func) == 242 && sizeof(yacc_config_t) == 256 && offsetof(yacc_config_t, crc) == 252);
    yacc_config_t d; config_defaults(&d);
    CHECK(d.tilt_func[0] == 0 && d.tilt_func[1] == 0 && d.tilt_func[2] == 0);
    CHECK(tilt_sw_func(&d) == F_STAR && atilt_func(&d, 0) == -1 && atilt_func(&d, 1) == F_STAR);
    for (int b = 0; b <= NUM_FUNCS; b++) { yacc_config_t x = d; x.tilt_func[0] = x.tilt_func[1] = x.tilt_func[2] = b; config_seal(&x); CHECK(config_validate(&x)); }
    for (int i = 0; i < 3; i++) { yacc_config_t x = d; x.tilt_func[i] = NUM_FUNCS + 1; config_seal(&x); CHECK(!config_validate(&x)); }
    { yacc_config_t x = d; x.tilt_func[0] = 1 + F_RED; CHECK(tilt_sw_func(&x) == F_RED); x.tilt_func[0] = 1 + F_PLUS; CHECK(tilt_sw_func(&x) == F_PLUS); }
    // upgrade of older layouts leaves star power
    { uint8_t v6[YACC_CFG_V6_SIZE]; yacc_config_t o = d; memcpy(v6, &o, 156); v6[4] = 6; uint32_t c = crc(v6, 156); memcpy(v6 + 156, &c, 4);
      yacc_config_t up; memset(&up, 0x5A, sizeof up); CHECK(config_from_old(v6, sizeof v6, &up)); CHECK(!up.tilt_func[0] && !up.tilt_func[1] && !up.tilt_func[2]); CHECK(config_validate(&up)); }
    // a v7 config written by 0.40 (zeroes at 242..251) is valid and means star power
    { yacc_config_t x = d; memset(x.reserved4, 0, sizeof x.reserved4); x.tilt_func[0]=0; config_seal(&x); CHECK(config_validate(&x)); CHECK(tilt_sw_func(&x) == F_STAR); }

    // ---- default behaviour: tilt switch = star power, never a button press
    fresh(); g_cfg.flags |= CFG_FLAG_TILT_ENABLED; g_cfg.tilt_pin = 19;
    step(50); CHECK(!input_tilt_star());
    setpin(19, 1); step(60); CHECK(input_tilt_star()); for (int f = 0; f < NUM_FUNCS; f++) CHECK(!input_func(f));
    setpin(19, 0); step(60); CHECK(!input_tilt_star());
    // switch disabled by flag: ignored
    g_cfg.flags &= ~CFG_FLAG_TILT_ENABLED; setpin(19, 1); step(60); CHECK(!input_tilt_star());
    // ---- switch as a fret / plus / strum up
    int fs[] = {F_GREEN, F_ORANGE, F_PLUS, F_STRUM_UP, F_STRUM_DOWN};
    for (unsigned k = 0; k < 5; k++) {
        fresh(); g_cfg.flags |= CFG_FLAG_TILT_ENABLED; g_cfg.tilt_pin = 19; g_cfg.tilt_func[0] = 1 + fs[k];
        setpin(19, 1); step(60);
        for (int f = 0; f < NUM_FUNCS; f++) CHECK(input_func(f) == (f == fs[k]));
        CHECK(!input_tilt_star());
        setpin(19, 0); step(60); CHECK(!input_func(fs[k]));
    }
    // normally closed switch: closed (pin low) at rest, open (pin high) = tilted
    fresh(); g_cfg.flags |= CFG_FLAG_TILT_ENABLED; g_cfg.tilt_pin = 19; g_cfg.tilt_invert = 1; g_cfg.tilt_func[0] = 1 + F_RED;
    setpin(19, 1); step(60); CHECK(!input_func(F_RED));            // pin low = closed = level
    setpin(19, 0); step(60); CHECK(input_func(F_RED));
    setpin(19, 1); step(60); CHECK(!input_func(F_RED));
    // ---- sensors
    fresh(); g_cfg.atilt[0].ch = ATILT_SRC_ACCEL_X; g_cfg.atilt[0].min = 1024; g_cfg.atilt[0].max = 3072; g_cfg.atilt[0].threshold = 50;
    g_cfg.atilt[0].target = ATILT_WHAMMY; accel_val[0] = 3072; step(5); CHECK(!input_func(F_GREEN) && !input_tilt_star());
    g_cfg.atilt[0].target = ATILT_STAR; step(5); CHECK(input_tilt_star());                       // default: star power, classic path
    for (int f = 0; f < NUM_FUNCS; f++) CHECK(!input_func(f));
    g_cfg.tilt_func[1] = 1 + F_YELLOW; step(5); CHECK(input_func(F_YELLOW) && !input_tilt_star());
    for (int f = 0; f < NUM_FUNCS; f++) if (f != F_YELLOW) CHECK(!input_func(f));
    // threshold + hysteresis: 50 % of 2048 range = 2048 (raw 2048 -> 50 %). on at >= 50 %, off at <= 46 %
    accel_val[0] = 1024 + 1024; step(5); CHECK(input_func(F_YELLOW));          // exactly 50 %
    accel_val[0] = 1024 + 1024 - 20; step(5); CHECK(input_func(F_YELLOW));       // 49 %: held by hysteresis
    accel_val[0] = 1024 + 950; step(5); CHECK(input_func(F_YELLOW));             // 46.4 %: above the 46 % release point
    accel_val[0] = 1024 + 900; step(5); CHECK(!input_func(F_YELLOW));
    accel_val[0] = 1024 + 1000; step(5); CHECK(!input_func(F_YELLOW));           // 48.8 %: below on, stays off
    accel_val[0] = 3072; step(5); CHECK(input_func(F_YELLOW));
    // invert
    g_cfg.atilt[0].invert = 1; step(5); CHECK(!input_func(F_YELLOW)); accel_val[0] = 1024; step(5); CHECK(input_func(F_YELLOW));
    // two inputs on the same function, ORed; sensor 2 as strum down; star power alongside
    fresh(); g_cfg.atilt[0].ch = ATILT_SRC_ACCEL_X; g_cfg.atilt[1].ch = ATILT_SRC_ACCEL_Y;
    for (int i = 0; i < 2; i++) { g_cfg.atilt[i].min = 1024; g_cfg.atilt[i].max = 3072; g_cfg.atilt[i].target = ATILT_STAR; }
    g_cfg.tilt_func[1] = 1 + F_STRUM_DOWN; g_cfg.tilt_func[2] = 1 + F_STRUM_DOWN;
    accel_val[0] = 1024; accel_val[1] = 3072; step(5); CHECK(input_func(F_STRUM_DOWN)); accel_val[1] = 2048 - 1024; step(5); CHECK(!input_func(F_STRUM_DOWN));
    accel_val[0] = 3072; step(5); CHECK(input_func(F_STRUM_DOWN));
    g_cfg.tilt_func[2] = 0; accel_val[1] = 3072; step(5); CHECK(input_tilt_star() && input_func(F_STRUM_DOWN));
    // a real button still works, ORed with a tilt press
    fresh(); g_cfg.pins[F_RED] = 5; g_cfg.flags |= CFG_FLAG_TILT_ENABLED; g_cfg.tilt_pin = 19; g_cfg.tilt_func[0] = 1 + F_RED;
    setpin(5, 1); step(60); CHECK(input_func(F_RED)); setpin(19, 1); step(60); CHECK(input_func(F_RED)); setpin(5, 0); step(60); CHECK(input_func(F_RED)); setpin(19, 0); step(60); CHECK(!input_func(F_RED));
    printf(fails ? "FAILED\n" : "tiltfn ok\n");
    return fails;
}
