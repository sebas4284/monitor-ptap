import { ScrollView, TouchableOpacity, Text, View } from 'react-native';
import { usePlant } from '../context/PlantContext';
import Colors from '../constants/colors';

export function PlantSelector() {
  const { selectedPlant, setSelectedPlant, plants } = usePlant();

  return (
    <View style={{ backgroundColor: Colors.bg, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}
      >
        {plants.map(plant => {
          const isSelected = plant === selectedPlant;
          return (
            <TouchableOpacity
              key={plant}
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
                {plant}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
