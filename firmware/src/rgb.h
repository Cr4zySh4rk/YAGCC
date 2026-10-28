#ifndef YACC_RGB_H_
#define YACC_RGB_H_
#include <stdint.h>
#include <stdbool.h>

void rgb_init(void);
void rgb_task(void);                       // call from the main loop, self-paced (~125 Hz)
void rgb_boot_indicator(uint8_t usb_mode); // flash the fret LED that selects this mode for 1 s
void rgb_test_led(int led);                // light only chain position `led` (white); -1 = normal again
bool rgb_active_pin(int p);
#define RGB_BT_OFF 0
#define RGB_BT_PAIRING 1
#define RGB_BT_CONNECTED 2
void rgb_set_bt(uint8_t state);              // pairing: blue double blink on all frets; connected: blue for 1 s
void rgb_set_charging(bool on);             // powered but no USB host (e.g. a charger): slow orange -> green chase
void rgb_set_off(bool off);                 // fade all LEDs to black (Bluetooth idle sleep); false = back to normal
bool rgb_is_dark(void);                     // the fade has finished and the black frame has been sent
void rgb_set_star_power(bool on);           // game says star power / overdrive is active                 // true while the PIO drives this GPIO
void rgb_set_whammy(uint16_t w);            // 0..32767, the bar and tilt-whammy combined
void rgb_set_player_star(bool pressed);     // the player's star power button / tilt is pressed (LEDF_STAR_FLASH)
void rgb_preview(uint16_t bits, bool on); // Lights page preview: bits 0..4 frets, 5 strum up, 6 down, 7 star, 8..15 whammy
#endif
