// Light haptics for moments that matter (a new hole, a score, a round starting or ending).
// iPhone app only; silently nothing on the web. iOS turns these off with the system setting.
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { isNative } from "./native";

export const tap = () => void (isNative && Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}));
export const success = () => void (isNative && Haptics.notification({ type: NotificationType.Success }).catch(() => {}));
