// Rumble motor output (see rumble.h)
#include "rumble.h"
#include "config.h"
#include "pico/stdlib.h"
#include "hardware/pwm.h"
#include "hardware/gpio.h"
#include "hardware/clocks.h"

#define PWM_HZ 20000              // above hearing, so the motor doesn't whine

static int8_t cur_pin = -1;
static uint16_t wrap;
static uint8_t game_level;
static uint8_t pulse_level;
static uint32_t pulse_until;

bool rumble_pin_active(int gpio) { return gpio >= 0 && gpio == cur_pin; }

static void set_out(uint8_t level) {
    if (cur_pin < 0) return;
    uint32_t duty = (uint32_t)level * g_cfg.rumble_strength * (wrap + 1u) / (255u * 100u);
    pwm_set_gpio_level((uint)cur_pin, (uint16_t)duty);
}

void rumble_task(void) {
    uint8_t pin = g_cfg.rumble_pin;
    int want = pin < NUM_DIGITAL_PINS ? pin : -1;
    if (want != cur_pin) {
        if (cur_pin >= 0) {                        // release the old pin
            pwm_set_enabled(pwm_gpio_to_slice_num((uint)cur_pin), false);
            gpio_init((uint)cur_pin); gpio_set_dir((uint)cur_pin, GPIO_IN); gpio_pull_up((uint)cur_pin);
        }
        cur_pin = (int8_t)want;
        if (cur_pin >= 0) {
            gpio_disable_pulls((uint)cur_pin);
            gpio_set_function((uint)cur_pin, GPIO_FUNC_PWM);
            uint slice = pwm_gpio_to_slice_num((uint)cur_pin);
            wrap = (uint16_t)(clock_get_hz(clk_sys) / PWM_HZ - 1);
            pwm_config c = pwm_get_default_config();
            pwm_config_set_wrap(&c, wrap);
            pwm_init(slice, &c, true);
            pwm_set_gpio_level((uint)cur_pin, 0);
        }
    }
    if (cur_pin < 0) return;
    uint32_t now = to_ms_since_boot(get_absolute_time());
    uint8_t level = (g_cfg.rumble_flags & RUMBLE_FLAG_GAME) ? game_level : 0;
    if (pulse_until && (int32_t)(now - pulse_until) < 0) { if (pulse_level > level) level = pulse_level; }
    else pulse_until = 0;
    set_out(level);
}

void rumble_game(uint8_t left, uint8_t right) { game_level = left > right ? left : right; }

// On guitars the XInput rumble channel also carries game commands (Santroller / YARG convention: right byte =
// command, left = parameter; stage kit lights, star power, multiplier, misses...). Those aren't rumble.
void rumble_xinput(uint8_t left, uint8_t right) {
    bool command = (right >= 0x01 && right <= 0x0C) || right == 0x20 || right == 0x40 || right == 0x60 ||
                   right == 0x80 || right == 0x90 || right == 0xA0 || right == 0xFF;
    if (!command) rumble_game(left, right);
}

static void pulse(uint8_t level, uint16_t ms) {
    pulse_level = level;
    pulse_until = to_ms_since_boot(get_absolute_time()) + ms;
    if (!pulse_until) pulse_until = 1;
}

void rumble_event(uint8_t ev) {
    if (ev == RUMBLE_EV_STAR && (g_cfg.rumble_flags & RUMBLE_FLAG_STAR)) pulse(255, 350);
    else if (ev == RUMBLE_EV_MISS && (g_cfg.rumble_flags & RUMBLE_FLAG_MISS)) pulse(200, 90);
}

void rumble_test(uint16_t ms) { pulse(255, ms > 2000 ? 2000 : ms); }
void rumble_stop(void) { game_level = 0; }
