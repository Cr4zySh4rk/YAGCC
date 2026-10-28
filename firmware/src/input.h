#ifndef YACC_INPUT_H_
#define YACC_INPUT_H_
#include <stdint.h>
#include <stdbool.h>
#include "config.h"

#define SLOT_TILT NUM_FUNCS      // debounce slot index used for the tilt switch
#define SLOT_EXT (NUM_FUNCS + 1)   // first of the NUM_EXT_PINS extension inputs (D-pad, select, home, stick click)
#define NUM_SLOTS (NUM_FUNCS + 1 + 7)

void input_init(void);
void input_poll(void);               // call as often as possible

// Detection grade (fixed 3 ms debounce) - used by the web wizard to find which pin moved
bool input_pressed(uint8_t gpio);
uint32_t input_gpio_mask(void);      // debounced level of GP0..22 (1 = high)
const uint8_t *input_press_counts(void);   // NUM_DIGITAL_PINS falling-edge counters (wrap at 256)

// Logical (user-tunable debounce) state of each control
bool input_func(int f);              // 0..NUM_FUNCS-1
bool input_tilt(void);               // the debounced tilt switch pin itself
bool input_tilt_star(void);          // a tilt input acting as star power is active (switch and / or sensors)
bool atilt_press(bool was_on, int32_t v, uint8_t threshold_pct);   // sensor press with 4 % hysteresis

uint16_t input_adc(uint8_t ch);      // filtered raw 12-bit
int16_t input_whammy(void);          // calibrated 0..32767
int32_t input_atilt_raw(uint8_t src); // 12-bit reading of a tilt sensor source (ATILT_SRC_*), -1 = none
int32_t input_atilt(int i);          // tilt sensor i calibrated 0 (rest) .. 32767 (tilted), -1 = off

// ---- firmware 0.42: extension inputs and the sources the mapping layer reads
bool input_func_phys(int f);         // the fret / strum / star / plus pin itself, without tilt inputs acting as it
bool input_ext(int k);               // extension pin k: 0..3 D-pad up / down / left / right, 4 select, 5 home, 6 stick click
bool input_ext_pin(int gpio);        // the GPIO belongs to an extension input (not a button for anything else)
bool input_tilt_switch(void);        // the tilt switch is fitted, enabled and closed (whatever it acts as on the Tune page)
int input_tilt_fn(int i);            // i 0 switch, 1..2 sensors: the F_* the Tune page has it pressing now (F_STAR included), -1 none
int32_t input_tilt_whammy(int i);    // sensor i (0..1) set to the whammy target: calibrated 0..32767, deadzone applied; else 0
bool input_stick(int16_t *x, int16_t *y);   // calibrated stick -32767..32767 (swap, invert, deadzone applied); false = no stick fitted (0, 0)
#endif
