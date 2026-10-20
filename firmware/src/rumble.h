// Rumble: a small vibration motor (through a transistor / MOSFET) on a GPIO, driven by PWM from what games
// send (XInput, PS4, PS5, original Xbox, PS2) and, if wanted, buzzing on star power and missed notes.
#ifndef YACC_RUMBLE_H_
#define YACC_RUMBLE_H_
#include <stdint.h>
#include <stdbool.h>
#ifdef __cplusplus
extern "C" {
#endif

enum { RUMBLE_EV_STAR = 0, RUMBLE_EV_MISS };

void rumble_task(void);                          // main loop: follows the configured pin, runs pulses
bool rumble_pin_active(int gpio);                // the motor's GPIO (not a button)
void rumble_game(uint8_t left, uint8_t right);   // motor levels a game asked for (0 = stop)
void rumble_xinput(uint8_t left, uint8_t right); // XInput rumble values: real rumble, or a guitar command (ignored here)
void rumble_event(uint8_t ev);                   // RUMBLE_EV_*
void rumble_test(uint16_t ms);                   // configurator "Test"
void rumble_stop(void);                          // host gone

#ifdef __cplusplus
}
#endif
#endif
