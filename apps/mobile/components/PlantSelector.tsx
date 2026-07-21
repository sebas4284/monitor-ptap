import { ScrollView, TouchableOpacity, Text, View } from 'react-native';
import { usePlant, PLANTS } from '../context/PlantContext';
import Colors from '../constants/colors';

/**
 * Selector de planta. Solo aparece para quien puede cambiar de planta (permiso
 * `view_all_plants`, hoy solo Admin): un operador está vinculado a UNA planta, así que
 * ofrecerle las demás sería enseñarle puertas que el backend cierra con 403. Las pantallas
 * muestran el nombre de la planta en su propia cabecera, así que no se pierde información.
 */
export function PlantSelector() {
  const { selectedPlant, setSelectedPlant, canSwitchPlant } = usePlant();

  if (!canSwitchPlant) return null;

  return (
    <View style={{ backgroundColor: Colors.bg, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}
      >
        {PLANTS.map((plant) => {
          const isSelected = plant.id === selectedPlant.id;
          return (
            <TouchableOpacity
              key={plant.id}
              onPress={() => setSelectedPlant(plant)}
              style={{
                paddingHorizontal: 18,
                paddingVertical: 7,
                borderRadius: 20,
                backgroundColor: isSelected ? Colors.primary : 'transparent',
                borderWidth: 1.5,
                borderColor: isSelected ? Colors.primary : Colors.textSecondary + '55',
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: isSelected ? '700' : '500',
                  color: isSelected ? '#fff' : Colors.textSecondary,
                }}
              >
                {plant.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
