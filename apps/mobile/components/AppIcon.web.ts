import createIconSet from '@expo/vector-icons/createIconSet';
import { createElement, type ComponentProps } from 'react';
import { Text } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import compactFont from '../assets/fonts/Ionicons.woff2';

const included: Record<string, number> = require('../assets/fonts/ionicons-used.json');
const CompactIcon = createIconSet(Ionicons.glyphMap, 'ionicons-aquora-web', compactFont);
const preloaded = typeof document !== 'undefined' && !!document.getElementById('aquora-fonts');
function AppIcon(props: ComponentProps<typeof Ionicons>) {
  // A new icon still works before the compact font is regenerated.
  if (!Object.hasOwn(included, props.name)) return createElement(Ionicons, props);
  if (!preloaded || Object.hasOwn(props, 'ref')) return createElement(CompactIcon, props);
  // Match the installed vector-icons Text renderer; CSS already declares this exact font.
  const { name, size = 12, color, style, children, allowFontScaling = false, ...rest } = props;
  return createElement(
    Text,
    {
      selectable: false,
      ...rest,
      allowFontScaling,
      style: [
        { fontSize: size, color },
        style,
        {
          fontFamily: 'ionicons-aquora-web',
          fontWeight: 'normal',
          fontStyle: 'normal',
        },
      ],
    },
    String.fromCodePoint(included[name]),
    children,
  );
}
AppIcon.glyphMap = Ionicons.glyphMap;
export default AppIcon;
