#ifndef YACC_INPUT_H_
#define YACC_INPUT_H_
#include <stdint.h>
#include <stdbool.h>
#include "config.h"

#define SLOT_TILT NUM_FUNCS      // debounce slot index used for the tilt switch
#define NUM_SLOTS (NUM_FUNCS + 1)

void input_init(void);
void input_poll(void);               // call as often as possible

// Detection grade (fixed 3 ms debounce) - used by the web wizard to find which pin moved
bool input_pressed(uint8_t gpio);
uint32_t input_gpio_mask(void);      // debounced level of GP0..22 (1 = high)
const uint8_t *input_press_counts(void);   // NUM_DIGITAL_PINS falling-edge counters (wrap at 256)

// Logical (user-tunable debounce) state of each control
bool input_func(int f);              // 0..NUM_FUNCS-1
bool input_tilt(void);

uint16_t input_adc(uint8_t ch);      // filtered raw 12-bit
int16_t input_whammy(void);          // calibrated 0..32767
int32_t input_atilt_raw(uint8_t src); // 12-bit reading of a tilt sensor source (ATILT_SRC_*), -1 = none
int32_t input_atilt(int i);          // tilt sensor i calibrated 0 (rest) .. 32767 (tilted), -1 = off
#endif
