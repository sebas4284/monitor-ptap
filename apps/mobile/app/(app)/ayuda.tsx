import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Ionicons from '../../components/AppIcon';
import Colors from '../../constants/colors';
import { Fonts } from '../../constants/fonts';
import { buscarFaq } from '../../services/faq';

const B = Colors.brand;

export default function AyudaScreen() {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const entries = useMemo(() => buscarFaq(query), [query]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        data={entries}
        extraData={expanded}
        keyExtractor={([codigo]) => codigo}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View>
            <Pressable
              onPress={() => router.navigate('/(app)/ajustes')}
              accessibilityRole="button"
              accessibilityLabel="Volver a Ajustes"
              style={({ pressed }) => [styles.back, pressed && styles.pressed]}
            >
              <Ionicons name="arrow-back" size={20} color={B.link} />
              <Text style={styles.backText}>Ajustes</Text>
            </Pressable>
            <Text accessibilityRole="header" style={styles.title}>
              Ayuda y problemas frecuentes
            </Text>
            <Text style={styles.description}>
              Busca el código del aviso o describe el problema. Cada respuesta explica qué revisar y
              con quién resolverlo. Abrir esta ayuda no envía comandos ni ejecuta diagnósticos.
            </Text>
            <View style={styles.guide}>
              <Text accessibilityRole="header" style={styles.guideTitle}>
                Antes de reportar
              </Text>
              <Text style={styles.description}>
                Anota planta, señal, código y hora. Una lectura visible puede ser antigua, y un
                comando enviado no confirma el movimiento de la válvula.
              </Text>
              <Text style={styles.description}>
                Si olvidaste tu contraseña, contacta al administrador: el restablecimiento requiere
                personal autorizado y la nueva contraseña se entrega una sola vez. Las cuentas
                nuevas necesitan verificar el correo y recibir aprobación.
              </Text>
              <Text style={styles.description}>
                Para demoras, el administrador revisa la salud OPC: droppedNotifications cuenta
                muestras superadas dentro de una ventana de agrupación y no implica por sí solo
                pérdida del enlace; publishLatencyMs mide demora de publicación y debe contrastarse
                con la antigüedad de la lectura.
              </Text>
            </View>
            <View style={styles.search}>
              <Ionicons name="search-outline" size={20} color={B.textSecondary} />
              <TextInput
                value={query}
                onChangeText={(value) => {
                  setQuery(value);
                  setExpanded(null);
                }}
                placeholder="Código o problema, por ejemplo NET-02"
                placeholderTextColor={B.textSecondary}
                accessibilityLabel="Buscar en Ayuda por código o problema"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                style={styles.input}
              />
              {query.length > 0 && (
                <Pressable
                  onPress={() => setQuery('')}
                  accessibilityRole="button"
                  accessibilityLabel="Limpiar búsqueda de Ayuda"
                  style={styles.clear}
                >
                  <Ionicons name="close-circle-outline" size={22} color={B.link} />
                </Pressable>
              )}
            </View>
            <Text accessibilityLiveRegion="polite" style={styles.count}>
              {entries.length} {entries.length === 1 ? 'respuesta' : 'respuestas'}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.guide}>
            <Text style={styles.guideTitle}>No encontramos ese problema</Text>
            <Text style={styles.description}>
              Prueba con el código completo o una palabra más corta. Si persiste, comunica al
              administrador el mensaje exacto, la planta y la hora, sin contraseñas ni tokens.
            </Text>
          </View>
        }
        renderItem={({ item: [codigo, entry] }) => {
          const open = expanded === codigo;
          return (
            <View style={styles.card}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${codigo}. ${entry.titulo}`}
                accessibilityState={{ expanded: open }}
                onPress={() => setExpanded(open ? null : codigo)}
                style={({ pressed }) => [styles.question, pressed && styles.pressed]}
              >
                <View style={styles.questionText}>
                  <Text style={styles.code}>{codigo}</Text>
                  <Text style={styles.questionTitle}>{entry.titulo}</Text>
                </View>
                <Ionicons
                  name={open ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={B.textSecondary}
                />
              </Pressable>
              {open && (
                <View style={styles.answer}>
                  <Text style={styles.label}>Qué significa</Text>
                  <Text style={styles.description}>{entry.queEs}</Text>
                  <Text style={styles.label}>Qué hacer y qué herramienta usar</Text>
                  <Text style={styles.description}>{entry.herramienta}</Text>
                  <Text style={styles.label}>Cómo interpretar el resultado</Text>
                  <Text style={styles.description}>{entry.queLeer}</Text>
                </View>
              )}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: B.page },
  content: { width: '100%', maxWidth: 900, alignSelf: 'center', padding: 16, paddingBottom: 32 },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  backText: { color: B.link, fontFamily: Fonts.medium, fontSize: 14 },
  title: {
    color: B.text,
    fontFamily: Fonts.semibold,
    fontSize: 24,
    lineHeight: 34,
    marginBottom: 8,
  },
  description: { color: B.textSecondary, fontFamily: Fonts.regular, fontSize: 14, lineHeight: 22 },
  guide: {
    backgroundColor: B.panel,
    borderWidth: 1,
    borderColor: B.cardBorder,
    borderRadius: 14,
    padding: 16,
    gap: 10,
    marginTop: 16,
    marginBottom: 16,
  },
  guideTitle: { color: B.text, fontFamily: Fonts.semibold, fontSize: 16 },
  search: {
    minHeight: 48,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: B.searchBorder,
    backgroundColor: B.card,
    borderRadius: 12,
    paddingLeft: 12,
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: B.text,
    fontFamily: Fonts.regular,
    fontSize: 14,
    paddingVertical: 12,
  },
  clear: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  count: { color: B.textSecondary, fontFamily: Fonts.regular, fontSize: 13, marginVertical: 12 },
  card: {
    backgroundColor: B.card,
    borderWidth: 1,
    borderColor: B.cardBorder,
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
  },
  question: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, minHeight: 64 },
  questionText: { flex: 1, gap: 4 },
  code: { color: B.link, fontFamily: Fonts.semibold, fontSize: 12 },
  questionTitle: { color: B.text, fontFamily: Fonts.medium, fontSize: 15, lineHeight: 22 },
  answer: { borderTopWidth: 1, borderTopColor: B.divider, padding: 16, gap: 8 },
  label: { color: B.text, fontFamily: Fonts.semibold, fontSize: 13, marginTop: 4 },
  pressed: { backgroundColor: B.selected },
});
