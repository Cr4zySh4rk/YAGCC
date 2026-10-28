// Bluetooth idle sleep (firmware 0.45). See idle_sleep.h for what counts as idle.
//
// After the configured time without a button press (and while no USB host uses the guitar) the LEDs fade out, the
// rumble motor stops, the Bluetooth host is dropped and the radio powered down, then the chip drops into a light
// sleep: the system clock runs from the crystal at 12 MHz with both PLLs and the USB / ADC clocks stopped, and the core
// waits in WFI for a falling edge on a fret / strum / star power / plus / extension pin. Any press then restarts the
// chip with a watchdog reset, so USB, Bluetooth (reconnecting to the paired host) and the LEDs come up exactly as at
// power-on. SLEEPWAKE_MAGIC in scratch 0 tells pick_mode() not to read the held button as a boot shortcut.
//
// A real DORMANT state (crystal stopped) would draw less, but the SDK has no support for it (pico_sleep lives in
// pico-extras and differs between RP2040 and RP2350), and it could not be tried on both chips here.
// Plugging in a USB host while asleep does not wake the guitar: the radio chip that reports USB power is off, and
// the USB clock is stopped; press a button.
#include "idle_sleep.h"
#include "bt.h"

#ifdef YACC_HAS_BT
#include "pico/stdlib.h"
#include "hardware/clocks.h"
#include "hardware/gpio.h"
#include "hardware/irq.h"
#include "hardware/pll.h"
#include "hardware/watchdog.h"
#include "hardware/structs/watchdog.h"
#include "tusb.h"
#include "config.h"
#include "ext_config.h"
#include "input.h"
#include "rgb.h"
#include "rumble.h"

static uint32_t wake_pin_mask(void) {
    uint32_t m = 0;
    for (int f = 0; f < NUM_FUNCS; f++) if (g_cfg.pins[f] < NUM_DIGITAL_PINS) m |= 1u << g_cfg.pins[f];
    for (int k = 0; k < NUM_EXT_PINS; k++) if (g_ext.pin_ext[k] < NUM_DIGITAL_PINS) m |= 1u << g_ext.pin_ext[k];
    return m;
}

static volatile bool s_woke;
static uint32_t s_mask;
static void wake_irq(void) {
    for (uint p = 0; p < NUM_DIGITAL_PINS; p++)
        if (((s_mask >> p) & 1) && (gpio_get_irq_event_mask(p) & GPIO_IRQ_EDGE_FALL)) { gpio_acknowledge_irq(p, GPIO_IRQ_EDGE_FALL); s_woke = true; }
}

static void sleep_now(void) {
    rumble_stop();
    rumble_task();
    tud_disconnect();                                    // the host must not find a half-dead device
    sleep_ms(50);
    irq_set_enabled(USBCTRL_IRQ, false);
    bt_power_down();

    s_mask = wake_pin_mask();
    uint32_t hist = gpio_get_all();
    for (uint p = 0; p < NUM_DIGITAL_PINS; p++) if ((s_mask >> p) & 1) gpio_set_irq_enabled(p, GPIO_IRQ_EDGE_FALL, true);
    gpio_add_raw_irq_handler_masked(s_mask, wake_irq);
    s_woke = false;

    // lowest practical clocks: crystal only
    uint32_t ref = clock_get_hz(clk_ref);
    clock_configure(clk_sys, CLOCKS_CLK_SYS_CTRL_SRC_VALUE_CLK_REF, 0, ref, ref);
    clock_stop(clk_usb);
    clock_stop(clk_adc);
#if PICO_RP2040
    clock_stop(clk_rtc);
#endif
    pll_deinit(pll_sys);
    pll_deinit(pll_usb);

    for (;;) {
        __wfi();
        uint32_t cur = gpio_get_all();
        hist |= cur;                                     // a pin counts as released once it has been seen high
        if (s_woke || (hist & ~cur & s_mask)) {
            s_woke = false;
            busy_wait_us(5000);                          // contact bounce / noise: the pin must still be low
            cur = gpio_get_all();
            if (hist & ~cur & s_mask) break;
            hist |= cur;
        }
    }
    watchdog_hw->scratch[0] = SLEEPWAKE_MAGIC;
    watchdog_reboot(0, 0, 10);
    for (;;) tight_loop_contents();
}

void idle_sleep_task(void) {
    static idle_t st;
    static bool fading;
    static uint32_t fade_t0;
    uint32_t now = to_ms_since_boot(get_absolute_time());

    uint32_t mask = 0;
    for (int f = 0; f < NUM_FUNCS; f++) if (input_func_phys(f)) mask |= 1u << f;
    for (int k = 0; k < NUM_EXT_PINS; k++) if (input_ext(k)) mask |= 1u << (NUM_FUNCS + k);
    int16_t sx = 0, sy = 0;
    input_stick(&sx, &sy);
    idle_update(&st, now, mask, input_whammy(), sx, sy);   // (tilt inputs are deliberately left out)

    bool eligible = bt_supported() && bt_running() && !tud_mounted() && bt_sleep_timeout_ms(g_ext.bt_sleep) != 0;
    if (!eligible) idle_hold(&st, now);
    bool due = eligible && idle_due(&st, now, g_ext.bt_sleep);
    if (!fading) {
        if (due) { fading = true; fade_t0 = now; rgb_set_off(true); }
    } else if (!due) {                                   // a press (or a host) during the fade: carry on
        fading = false;
        rgb_set_off(false);
    } else if (rgb_is_dark() || now - fade_t0 > 2500) sleep_now();
}
#else
void idle_sleep_task(void) {}
#endif
