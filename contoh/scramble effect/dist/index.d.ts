/// <reference types="react" />
declare type RangeOrCharCodes = {
    0: number;
    1: number;
} & Array<number>;
export declare type UseScrambleProps = {
    /**
     * When playOnMount is true, the animation will not play the first time a text input is provided.
     */
    playOnMount?: boolean;
    /**
     * Optional text input
     */
    text?: string;
    /**
     * 0-1 range that determines the scramble speed. A speed of 1 will redraw 60 times a second. A speed of 0 will pause the animation
     *
     * @default 1
     */
    speed?: number;
    /**
     * The controller will move forward along the text input and scramble more characters, at a pace of `tick` frames. Combined with the `speed` prop, you can control the animation rate
     *
     * @default 1
     */
    tick?: number;
    /**
     * Step forward on every tick
     *
     * @default 1
     */
    step?: number;
    /**
     * Chance of scrambling a character, range from 0 to 1, 0 being no chance, and 1 being 100% chance
     */
    chance?: number;
    /**
     * Randomize `seed` characters at random text positions
     *
     * @default 1
     */
    seed?: number;
    /**
     * How many times to scramble each character?
     *
     * @default 1
     */
    scramble?: number;
    /**
     * Characters to avoid scrambling
     */
    ignore?: string[];
    /**
     * Unicode character range for scrambler.
     *
     * If a tupple is provided [60,125], it will randomly choose a unicode character code within that range.
     *
     * If the array contains more than two unicode values, it will choose randomly from the array values only.
     *
     * To randomize with only two values, you can repeat them in the array [91,93,91,93]
     *
     * @default [65,125]
     */
    range?: RangeOrCharCodes;
    /**
     * Set the animation to overdrive mode, and set the unicode character code to use in the animation
     */
    overdrive?: boolean | number;
    /**
     * Always start text animation from an empty string
     *
     * @default false
     */
    overflow?: boolean;
    /**
     * Callback when animation starts drawing
     */
    onAnimationStart?: Function;
    /**
     * Callback for when the animation finished
     */
    onAnimationEnd?: Function;
    /**
     * onRedraw callback
     */
    onAnimationFrame?: (result: string) => void;
};
export declare const useScramble: (props: UseScrambleProps) => {
    ref: import("react").MutableRefObject<any>;
    replay: () => void;
};
export {};
